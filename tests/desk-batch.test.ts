import test from "node:test";
import assert from "node:assert/strict";
import { BatchedGamma } from "../src/live/gamma.js";
import { decodeAncillary } from "../src/collect/ancillary.js";
import { runDeskCycle } from "../src/live/desk.js";
import type { Proposal } from "../src/live/desk.js";
import type { OracleRequest } from "../src/collect/types.js";

const now = Date.parse("2026-11-14T02:31:00Z");
const finished = "2026-11-14T02:30:23.355Z";
const rules = "This NBA game is scheduled for November 13, 2026 at 7:00 PM ET. The full game winner determines resolution.";
function proposal(id: string, second = 26): Proposal {
  const title = "Bucks vs. Magic: Moneyline"; const text = `q: title: ${title}, description: ${rules}. Where p1 corresponds to No, p2 to Yes.`;
  const ancillary = decodeAncillary(`0x${Buffer.from(text + id).toString("hex")}`);
  return { proposal_id: `fixture:${id}`, deployment: "managed-oov2", title, rules_text: text, ancillary, market_id: id,
    proposal_time_utc: `2026-11-14T02:30:${String(second).padStart(2, "0")}.000Z`, liveness_ends_utc: "2026-11-14T04:30:00Z",
    raw: { id, requester: "fixture", proposedPrice: "0", currency: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", bond: "250000000", proposalHash: `0x${id}`, proposalLogIndex: "1", requestHash: "0xrequest" } as OracleRequest };
}
function row(id: string, complete = true) {
  return { id, slug: `market-${id}`, question: "Bucks vs. Magic: Moneyline", description: rules, outcomes: '["No","Yes"]', sportsMarketType: "moneyline",
    events: [{ id: "game-1", slug: "bucks-magic", title: "Bucks vs. Magic", ...(complete ? { ended: true, finishedTimestamp: finished, score: "110-104", period: "FT" } : {}) }] };
}

test("381 markets use ten batches of at most 40 ids, at most four concurrent, and share one event feed", async () => {
  let clock = now; let active = 0; let peak = 0; const calls: URL[] = [];
  const batch = new BatchedGamma(async (path) => {
    const u = new URL(path, "https://gamma-api.polymarket.com"); calls.push(u);
    const ids = u.searchParams.getAll("id"); assert.ok(ids.length <= 40); assert.equal(u.pathname, "/markets");
    active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 1)); active--;
    return { value: ids.map((id) => row(id, id === "1")), fetched_at: new Date(clock).toISOString() };
  }, () => clock);
  const ps = Array.from({ length: 381 }, (_, i) => proposal(String(i + 1)));
  await batch.prime(ps);
  for (const p of ps) {
    const market = await batch.lookup(p); const evidence = await batch.evidence(p.market_id!);
    assert.equal(market?.sportsMarketType, "moneyline"); assert.equal(market?.scheduling.market.sportsMarketType, "moneyline");
    assert.equal(evidence?.finished_utc, finished); assert.equal(market?.game?.score, "110-104");
  }
  assert.equal(calls.length, 10); assert.equal(peak, 4);
  await batch.prime(ps); assert.equal(calls.length, 10);
  clock += 600_001; await batch.prime(ps); assert.equal(calls.length, 20);
});

test("a batch miss falls back to an exact single id; unrelated returned markets are ignored", async () => {
  const calls: string[] = [];
  const batch = new BatchedGamma(async (path) => {
    calls.push(path); const ids = new URL(path, "https://example.test").searchParams.getAll("id");
    return { value: ids.length > 1 ? [row("1"), row("999")] : [row(ids[0]!)], fetched_at: new Date(now).toISOString() };
  }, () => now);
  const ps = [proposal("1"), proposal("2")]; await batch.prime(ps);
  assert.equal((await batch.lookup(ps[1]!))?.id, "2"); assert.deepEqual(calls, ["/markets?id=1&id=2&limit=40", "/markets?id=2"]);
});

test("sibling markets share one slug fallback, including when the event has no feed", async () => {
  for (const hasFeed of [true, false]) {
    let calls = 0;
    const batch = new BatchedGamma(async (path) => {
      calls++; const u = new URL(path, "https://example.test");
      return { value: u.pathname === "/markets" ? u.searchParams.getAll("id").map((id) => row(id, false))
        : [{ id: "game-1", slug: "bucks-magic", title: "Bucks vs. Magic", ...(hasFeed ? { ended: true, finishedTimestamp: finished } : {}) }], fetched_at: new Date(now).toISOString() };
    }, () => now);
    const ps = [proposal("1"), proposal("2"), proposal("3")]; await batch.prime(ps);
    const evidence = await Promise.all(ps.map((p) => batch.evidence(p.market_id!)));
    assert.equal(calls, 2); assert.ok(evidence.every((e) => hasFeed ? e?.finished_utc === finished : e === null));
    await batch.evidence("1"); assert.equal(calls, 2);
  }
});

test("desk totals expose final-feed timing, distinct games and all live USDC bonds", async () => {
  const batch = new BatchedGamma(async (path) => ({ value: new URL(path, "https://example.test").searchParams.getAll("id").map((id) => row(id)), fetched_at: new Date(now).toISOString() }), () => now);
  const ps = [proposal("1", 26), proposal("2", 28), proposal("3", 30)];
  const snapshot = await runDeskCycle({ proposals: async () => ps, prepare: (p) => batch.prime(p), gamma: (p) => batch.lookup(p), evidence: (p) => batch.evidence(p.market_id),
    saved: async () => ({ read: false, check: null }), check: async () => { assert.fail("SERV disabled"); } }, { cap: 0 }, () => now);
  assert.equal(snapshot.totals.on_time_by_feed, 3); assert.equal(snapshot.totals.passes_code, 0); assert.equal(snapshot.totals.games, 1);
  assert.equal(snapshot.totals.bond_in_liveness_usdc, 750); assert.equal(snapshot.totals.median_seconds_after_final, 4.645);
  assert.equal(snapshot.items[0]!.seconds_after_final, 2.645); assert.equal(snapshot.items[0]!.game?.title, "Bucks vs. Magic");
  assert.equal(snapshot.items[0]!.sports_scope, "FULL_GAME_RESULT"); assert.equal(snapshot.items[0]!.sports_market_type, "moneyline");
});
