import test from "node:test";
import assert from "node:assert/strict";
import { MarketExamples, EXAMPLES_TTL_MS, EXAMPLES_REQUEST_CAP, openUntil, sportsExamples } from "../src/api/examples.js";
import { cryptoExamples, EXAMPLE_MARGIN_MS, fallbackExamples } from "../src/demo/example-links.js";
import { GammaLiveClient } from "../src/collect/gamma.js";
import { gammaMarket } from "../src/demo/live.js";
import type { LiveResolution } from "../src/demo/live.js";
import type { DeskItem } from "../src/live/desk.js";
import { loadExamples } from "../web/src/example-utils.js";
import { runDeskCycle } from "../src/live/desk.js";
import type { Proposal } from "../src/live/desk.js";
import { decodeAncillary } from "../src/collect/ancillary.js";
import type { OracleRequest } from "../src/collect/types.js";

const now = Date.parse("2026-11-14T12:00:00Z");
const event = (slug: string) => `https://polymarket.com/event/${slug}`;
function resolution(url: string, end = now + 86_400_000, closed = false): LiveResolution {
  return { source: "gamma_live", rules_source: "fixture", fetched_at: new Date(now).toISOString(), url,
    markets: [gammaMarket({ id: "1", slug: "fixture", question: "Fixture market", outcomes: ["No", "Yes"], closed, active: true, endDate: new Date(end).toISOString() })], selected_market_id: "1" };
}
function service(resolve: (url: string) => Promise<LiveResolution>, options: { fallback?: unknown; items?: Pick<DeskItem, "game" | "event_slug" | "polymarket_url">[]; clock?: () => number; advance?: (ms: number) => void } = {}) {
  let clock = now;
  return new MarketExamples({ resolve, snapshot: () => ({ items: options.items ?? [] }), fallback: async () => options.fallback ?? [],
    now: options.clock ?? (() => clock), pause: async (ms) => { if (options.advance) options.advance(ms); else clock += ms; } });
}
function sports(slug: string | null, ended: boolean | null = false, finished_utc: string | null = null): Pick<DeskItem, "game" | "event_slug" | "polymarket_url"> {
  return { event_slug: slug, game: { event_id: "game", title: "Game", ended, finished_utc, score: "1-0", period: "Q3" } };
}

test("example crypto slugs use UTC dates across month/year boundaries and leap day", () => {
  for (const [time, expected] of [
    ["2026-11-30T23:59:00-03:00", ["december-1-2026", "december-2-2026", "december-3-2026"]],
    ["2026-12-31T23:59:59Z", ["december-31-2026", "january-1-2027", "january-2-2027"]],
    ["2028-02-28T00:00:00Z", ["february-28-2028", "february-29-2028", "march-1-2028"]],
  ] as const) for (const asset of ["bitcoin", "ethereum"] as const) {
    assert.deepEqual(cryptoExamples(Date.parse(time), asset).map((r) => r.url), expected.map((date) => event(`${asset}-above-on-${date}`)));
  }
});

test("example open filtering rejects closed/unknown/expired markets and the exact 20-minute boundary", () => {
  const url = event("fixture");
  for (const delta of [-1, 0, 1, EXAMPLE_MARGIN_MS]) assert.equal(openUntil(resolution(url, now + delta), now), null);
  assert.equal(openUntil(resolution(url, now + EXAMPLE_MARGIN_MS + 1), now), now + 1);
  assert.equal(openUntil(resolution(url, now + 86_400_000, true), now), null);
  const unknown = resolution(url); unknown.markets[0]!.closed = null; assert.equal(openUntil(unknown, now), null);
  const invalid = resolution(url); invalid.markets[0]!.endDate = "invalid"; assert.equal(openUntil(invalid, now), null);
  const inactive = resolution(url); inactive.markets[0]!.active = false; assert.equal(openUntil(inactive, now), null);
  const nested = resolution(url, now - 1);
  nested.markets.push({ ...nested.markets[0]!, id: "2", endDate: new Date(now + 86_400_000).toISOString() });
  assert.equal(openUntil(nested, now), null); // A closed selection cannot borrow a live sibling.
  nested.selected_market_id = null; assert.ok(openUntil(nested, now));
});

test("examples keep the first qualifying Bitcoin and Ethereum, then validate one snapshot game", async () => {
  const calls: string[] = [];
  const selected = service(async (url) => {
    calls.push(url);
    return resolution(url, now + 86_400_000, /bitcoin-above-on-november-14/u.test(url));
  }, { items: [sports("nba-live-fixture")] });
  const data = await selected.get();
  assert.deepEqual(data.examples.map((r) => r.url), [event("bitcoin-above-on-november-15-2026"), event("ethereum-above-on-november-14-2026"), event("nba-live-fixture")]);
  assert.deepEqual(data.examples.map((r) => r.kind), ["crypto", "crypto", "sports"]);
  assert.equal(data.examples[0]!.label, "Bitcoin price at a fixed time");
  assert.equal(data.examples[1]!.label, "Ethereum price at a fixed time");
  assert.equal(data.examples[2]!.label, "A game in play");
  assert.equal(calls.length, 4);
});

test("example refresh request cap includes failures and prevents fallback/sports floods", async () => {
  let clock = now; const calls: string[] = [];
  const gamma = new GammaLiveClient(async (url) => { calls.push(url); return "[]"; }, () => clock);
  const examples = service((url) => gamma.resolve(url), { clock: () => clock, advance: (ms) => { clock += ms; },
    items: Array.from({ length: 30 }, (_, i) => sports(`game-${i}`)),
    fallback: Array.from({ length: 30 }, (_, i) => ({ label: "Fallback", url: event(`fallback-${i}`) })) });
  const data = await examples.get();
  assert.equal(calls.length, EXAMPLES_REQUEST_CAP); assert.equal(EXAMPLES_REQUEST_CAP, 12);
  assert.ok(calls.every((url) => new URL(url).pathname === "/events"));
  assert.deepEqual(data.examples, []);
  assert.equal(new Date(data.generated_at).getTime(), clock);
  assert.ok(clock >= now + 11_000); // The resolver limiter remains active, with no 429 retry loop.
});

test("saved fallback order is retained after crypto/sports, duplicates and invalid links are skipped", async () => {
  const calls: string[] = [];
  const fallback = [
    { label: "Invalid", url: "https://example.com/event/not-polymarket" },
    { label: "Duplicate failed crypto", url: cryptoExamples(now, "bitcoin")[0]!.url },
    { label: "Closed", url: event("closed") },
    { label: "First saved", url: event("first-saved") },
    { label: "Same link", url: event("first-saved") },
    { label: "Second saved", url: event("second-saved") },
    { label: "Third saved", url: event("third-saved") },
    { label: "Never queried", url: event("fourth-saved") },
  ];
  const examples = service(async (url) => {
    calls.push(url); if (url.includes("-above-on-")) throw new Error("No event");
    return resolution(url, now + 86_400_000, url === event("closed"));
  }, { fallback });
  const rows = (await examples.get()).examples;
  assert.deepEqual(rows.map((r) => r.label), ["First saved", "Second saved", "Third saved"]);
  assert.ok(rows.every((r) => r.kind === "static")); assert.equal(calls.length, 10);
  assert.ok(!calls.includes(event("fourth-saved")));
});

test("sports candidates use known event slugs, deduplicate, and omit old/future finishes", async () => {
  const finished = new Date(now - 2 * 3_600_000).toISOString();
  const snapshot = { items: [
    sports("too-old", true, new Date(now - 3 * 3_600_000 - 1).toISOString()),
    sports("future", true, new Date(now + 86_400_000).toISOString()), sports(null),
    { ...sports(null), polymarket_url: "https://polymarket.com/market/not-an-event" },
    sports("live"), sports("live"), sports("final", true, finished),
    { ...sports(null, true, finished), polymarket_url: event("known-event") },
  ] };
  assert.deepEqual(sportsExamples(snapshot, now).map((r) => r.url), [event("live"), event("final"), event("known-event")]);
  assert.deepEqual(sportsExamples({ ...snapshot, stale: true }, now), []);
  const calls: string[] = [];
  const selected = service(async (url) => { calls.push(url); if (url === event("live")) throw new Error("No usable markets"); return resolution(url, url.includes("-above-on-") ? now + 86_400_000 : now - 3_600_000); }, { items: snapshot.items });
  const data = await selected.get();
  assert.equal(data.examples[2]!.url, event("final")); assert.equal(data.examples[2]!.label, "A game that just finished");
  assert.ok(!calls.includes(event("known-event")));
});

test("examples coalesce concurrent GETs, cache for ten minutes and filter entries nearing expiry", async () => {
  let clock = now; let calls = 0;
  const examples = service(async (url) => { calls++; return resolution(url, now + EXAMPLE_MARGIN_MS + 60_000); }, { clock: () => clock, advance: (ms) => { clock += ms; } });
  const [a, b] = await Promise.all([examples.get(), examples.get()]);
  assert.deepEqual(a, b); assert.equal(calls, 2); assert.equal(a.examples.length, 2);
  await examples.get(); assert.equal(calls, 2);
  clock = now + 60_000; assert.deepEqual((await examples.get()).examples, []); assert.equal(calls, 2);
  clock += EXAMPLES_TTL_MS; await examples.get(); assert.equal(calls, 8);
});

test("client fallback is local, date filtered and capped; malformed/undated links cannot revive stale chips", () => {
  const rows = [
    { label: "Past NBA", url: event("nba-gsw-sas-2026-11-13") },
    { label: "Undated", url: event("unknown-date") },
    { label: "Invalid date", url: event("bitcoin-above-on-february-30-2027") },
    { label: "Closed", url: event("bitcoin-above-on-november-16-2026"), closed: true },
    { label: "Near expiry", url: event("bitcoin-above-on-november-16-2026"), endDate: new Date(now + EXAMPLE_MARGIN_MS).toISOString() },
    ...cryptoExamples(now, "bitcoin"), ...cryptoExamples(now, "ethereum"),
  ];
  assert.deepEqual(fallbackExamples(rows, now).map((r) => r.url), cryptoExamples(now, "bitcoin").map((r) => r.url));
  assert.deepEqual(fallbackExamples(cryptoExamples(now, "bitcoin"), now + 3 * 86_400_000), []);
});

test("web requests API first; only transport rejection permits the filtered saved fallback", async () => {
  const link = cryptoExamples(now, "bitcoin")[1]!;
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetcher = (fn: (url: string) => Promise<Response>) => fn as typeof fetch;
  for (const apiResponse of [response({ examples: [] }), response({ error: "rate limited" }, 429), response({ error: "failed" }, 502), response({ examples: "invalid" })]) {
    const calls: string[] = [];
    assert.deepEqual(await loadExamples(fetcher(async (url) => { calls.push(url); return apiResponse; }), undefined, now), []);
    assert.deepEqual(calls, ["/api/examples"]);
  }
  const calls: string[] = [];
  const fallback = await loadExamples(fetcher(async (url) => {
    calls.push(url); if (url === "/api/examples") throw new TypeError("Network unavailable");
    return response([{ label: "Past", url: event("nba-gsw-sas-2026-11-13") }, link]);
  }), undefined, now);
  assert.deepEqual(calls, ["/api/examples", "/data/examples.json"]); assert.equal(fallback.length, 1); assert.equal(fallback[0]!.url, link.url);
  const success = await loadExamples(fetcher(async () => response({ generated_at: new Date(now).toISOString(), examples: [link] })), undefined, now);
  assert.deepEqual(success, [link]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadExamples(fetcher(async () => { throw new Error("Aborted"); }), controller.signal, now));
});

test("desk snapshots retain an unambiguous Gamma event slug for sports examples", async () => {
  const rules = "Winner of this MLB game scheduled for November 14, 2026 at 12:00 PM UTC.";
  const proposal: Proposal = { proposal_id: "fixture", deployment: "fixture", raw: { id: "fixture", proposedPrice: "0", requester: "fixture", currency: "USDC", bond: "1", proposalLogIndex: "1", proposalHash: "0xfixture", requestHash: "0xrequest" } as OracleRequest,
    ancillary: decodeAncillary(`0x${Buffer.from(rules).toString("hex")}`), title: "MLB A vs B", rules_text: rules, market_id: "1", proposal_time_utc: new Date(now).toISOString(), liveness_ends_utc: new Date(now + 3_600_000).toISOString() };
  const market = gammaMarket({ id: "1", slug: "market-slug", question: "MLB A vs B", outcomes: ["No", "Yes"], events: [{ id: "event", slug: "event-slug" }] });
  const snapshot = await runDeskCycle({ proposals: async () => [proposal], gamma: async () => market, evidence: async () => null,
    saved: async () => ({ read: false, check: null }), check: async () => null }, { cap: 0 }, () => now);
  assert.equal(snapshot.items[0]!.event_slug, "event-slug");
});
