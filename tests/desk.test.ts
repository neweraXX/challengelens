import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ADAPTERS } from "../config/adapters.js";
import { fetchLiveProposals, proposalPacket, screenProposal, selectServ, flagFor, runDeskCycle, bondUsdc } from "../src/live/desk.js";
import type { CycleFetchers, DeskCheck, GraphFetcher, Prepared, Proposal, Screen } from "../src/live/desk.js";
import { historySummary, recordFlags, updateHistory } from "../src/live/history.js";
import { LiveDesk } from "../src/live/runtime.js";
import { ServSlots } from "../src/live/serv-limit.js";
import { evaluateGate } from "../src/gate/decide.js";
import type { LiveMarket } from "../src/demo/live.js";
import type { OracleRequest } from "../src/collect/types.js";
import type { Verdict } from "../src/judge/schema.js";
import type { SportsEvidence } from "../src/evidence/sports.js";

const now = Date.parse("2026-11-14T12:30:00Z");
const stamp = (s: string) => String(Date.parse(s) / 1000);
const candleRules = "The price of the Binance 1 minute candle for Bitcoin at November 14, 2026 at 7:00 AM ET determines resolution.";
function raw(id: string, proposal = "2026-11-14T11:59:44Z", title = "Will Bitcoin be above $95,000?", rules = candleRules): OracleRequest {
  return { id, requester: ADAPTERS[0].address, identifier: "YES_OR_NO_QUERY", time: "1", ancillaryData: `0x${Buffer.from(`q: title: ${title}, description: ${rules}, market_id: 123`).toString("hex")}`,
    proposer: "proposer", proposedPrice: "0", disputer: null, state: "Proposed", requestTimestamp: "1", requestBlockNumber: "1", requestHash: "0xrequest", requestLogIndex: "0",
    proposalTimestamp: stamp(proposal), proposalBlockNumber: "1", proposalHash: `0x${id}`, proposalLogIndex: "1", proposalExpirationTimestamp: stamp("2026-11-14T14:30:00Z"),
    disputeTimestamp: null, disputeHash: null, settlementPrice: null, settlementTimestamp: null, settlementHash: null,
    currency: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", bond: "250000000", finalFee: "0", reward: "0", customLiveness: "7200", eventBased: false };
}
async function proposals(rows: OracleRequest[]): Promise<Proposal[]> {
  return fetchLiveProposals(async (d) => d.name === "managed-oov2" ? rows : [], now);
}
const market: LiveMarket = { id: "123", slug: "bitcoin-candle", question: "Gamma title should not govern", description: "Gamma description should not govern", endDate: "2026-11-14T12:00:00Z",
  gameStartTime: null, startTime: null, closed: false, active: true, outcomes: ["No", "Yes"], scheduling: { market: { id: "123", slug: "bitcoin-candle", endDate: "2026-11-14T12:00:00Z" }, events: [] } };
const feed: SportsEvidence = { kind: "sports_feed", source: "polymarket_gamma_event", event_id: "game", slug: "game", ended: false, finished_utc: null, score: "0-0", period: "1", fetched_at: new Date(now).toISOString() };
function serv(decision: Verdict["decision"] = "NOT_SUPPORTED_NOW"): Verdict {
  return { decision, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null, decisive_time_utc: "2026-11-14T12:01:00Z", sports: null,
    decisive_local: { date: "2026-11-14", time: "12:00", timezone: "UTC", adjust_minutes: 1 },
    checks: { timing: { status: decision === "SUPPORTED_NOW" ? "PASS" : decision === "NOT_SUPPORTED_NOW" ? "FAIL" : "UNKNOWN", clause_quote: "price", explanation: "Compare the proposal with candle close." } } };
}
function checked(item: Prepared, decision: Verdict["decision"] = "NOT_SUPPORTED_NOW"): DeskCheck {
  const verdict = serv(decision);
  return { result: evaluateGate(item.packet.model_inputs, verdict), verdict, receipt_id: item.proposal.raw.id };
}

test("both deployments paginate within 800 rows and liveness/requester filtering is local", async () => {
  const rows = [raw("valid"), { ...raw("expired"), proposalExpirationTimestamp: stamp("2026-11-14T12:30:00Z") }, { ...raw("unknown"), requester: "0x" + "f".repeat(40) }, { ...raw("settled"), state: "Settled" }, raw("future", "2026-11-14T13:00:00Z")];
  const result = await proposals(rows); assert.deepEqual(result.map((r) => r.raw.id), ["valid"]);
  assert.equal(result[0]!.market_id, "123"); assert.equal(result[0]!.title, "Will Bitcoin be above $95,000?");
  assert.ok(ADAPTERS.some((a) => a.address === "0x53703dd6129d723066b6362510e5ae2fecd48218" && !a.verified));
  let fetched = 0; const calls: string[] = [];
  const fetcher: GraphFetcher = async (d, query, v) => {
    calls.push(`${d.name}:${v.skip}`); assert.match(query, /state: Proposed/u); assert.match(query, /orderBy: proposalTimestamp/u);
    const count = d.name === "oov2" ? 8 : Number(v.first); fetched += count;
    return Array.from({ length: count }, (_, i) => raw(`${d.name}-${v.skip}-${i}`));
  };
  assert.equal((await fetchLiveProposals(fetcher, now)).length, 800); assert.equal(fetched, 800); assert.equal(calls.length, 5);
});

test("onchain rules govern, proposal seconds are preserved, and candles screen before/after close", async () => {
  for (const [time, screen] of [["2026-11-14T11:59:44Z", "TOO_EARLY_BY_CODE"], ["2026-11-14T12:01:00Z", "PASSES_CODE"]] as const) {
    const p = (await proposals([raw(time, time)]))[0]!; const packet = proposalPacket(p, market, new Date(now).toISOString());
    assert.equal(packet.source, "uma_live_proposal"); assert.equal(packet.model_inputs.rules_text, p.ancillary.decodedText);
    assert.ok(!packet.model_inputs.rules_text.includes(market.description)); assert.equal(packet.model_inputs.proposal_time_utc, new Date(time).toISOString());
    assert.match(packet.rules_source, /Onchain UMA ancillary/u); assert.equal(screenProposal(packet, null).screen, screen);
    assert.equal(screenProposal(packet, null).instants.code_cutoff_utc, "2026-11-14T12:01:00.000Z");
  }
});

test("sports feed proofs beat schedules; missing feeds and unsupported families supply no desk key", async () => {
  const p = (await proposals([raw("game", undefined, "MLB: A vs B", "This MLB game is scheduled for November 14, 2026 at 1:00 PM ET.")]))[0]!;
  const packet = proposalPacket(p, market, new Date(now).toISOString());
  assert.equal(screenProposal(packet, feed).screen, "TOO_EARLY_BY_CODE");
  assert.equal(screenProposal(packet, null).screen, "NO_DETERMINISTIC_KEY");
  assert.equal(screenProposal(packet, { ...feed, ended: true, finished_utc: "2026-11-14T11:00:00Z" }).screen, "ON_TIME_BY_FEED");
  const unsupported = (await proposals([raw("other", undefined, "Will the policy pass?", "Resolves when the policy passes.")]))[0]!;
  assert.equal(screenProposal(proposalPacket(unsupported, market, new Date(now).toISOString()), null).screen, "NO_DETERMINISTIC_KEY");
});

test("early YES is not marked premature from a future window end alone", async () => {
  const r = raw("yes", undefined, "Will the event happen?", "An event between November 14, 2026 at 10:00 AM UTC and November 15, 2026 at 10:00 PM UTC determines resolution."); r.proposedPrice = "1000000000000000000";
  const p = (await proposals([r]))[0]!;
  assert.equal(screenProposal(proposalPacket(p, market, new Date(now).toISOString()), null).screen, "NO_DETERMINISTIC_KEY");
});

test("price proof compares the touching candle close with the exact proposal second", async () => {
  const row = raw("touch", undefined, "Will Solana reach $250 November 9-15?", "Binance prices between November 9, 2026 at 12:00 AM UTC and November 15, 2026 at 11:59 PM UTC.");
  row.proposedPrice = "1000000000000000000";
  const p = (await proposals([row]))[0]!; const packet = proposalPacket(p, market, new Date(now).toISOString());
  const evidence = { kind: "price_touch" as const, source: "binance_klines_1m" as const, symbol: "SOLUSDT", target: 250, direction: "high" as const,
    window_start_utc: "2026-11-09T00:00:00Z", scanned_until_utc: "2026-11-14T12:00:00Z", first_touch_utc: "2026-11-14T11:59:59.999Z", candles_scanned: 100 };
  const before = screenProposal(packet, evidence);
  assert.equal(before.screen, "NO_DETERMINISTIC_KEY"); assert.equal(before.instants.evidence_time_utc, evidence.first_touch_utc);
  assert.equal(screenProposal({ ...packet, model_inputs: { ...packet.model_inputs, proposal_time_utc: "2026-11-14T12:00:00Z" } }, evidence).screen, "ON_TIME_BY_FEED");
});

test("SERV selection prioritizes all unread code concerns, samples passes, obeys caps and skips no-key", () => {
  const rows = [ { id: "cached", screen: "TOO_EARLY_BY_CODE" as Screen, read: true }, ...Array.from({ length: 4 }, (_, i) => ({ id: `early-${i}`, screen: "TOO_EARLY_BY_CODE" as Screen, read: false })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `pass-${i}`, screen: (i === 0 ? "ON_TIME_BY_FEED" : "PASSES_CODE") as Screen, read: false })), { id: "no-key", screen: "NO_DETERMINISTIC_KEY" as Screen, read: false } ];
  assert.deepEqual(selectServ(rows, 2, 3).map((r) => r.id), ["early-0", "early-1", "early-2"]);
  assert.deepEqual(selectServ(rows, 2, 25).map((r) => r.id), ["early-0", "early-1", "early-2", "early-3", "pass-0", "pass-1"]);
  assert.deepEqual(selectServ(rows, 0, 0), []);
});

test("flags require deterministic prematurity AND a SERV premature verdict", async () => {
  const p = (await proposals([raw("early")]))[0]!;
  const packet = proposalPacket(p, market, new Date(now).toISOString()); const item: Prepared = { proposal: p, packet, evidence: null, screening: screenProposal(packet, null) };
  assert.equal(flagFor("TOO_EARLY_BY_CODE"), "CODE_ONLY");
  assert.equal(flagFor("TOO_EARLY_BY_CODE", checked(item), true), "LIKELY_TOO_EARLY");
  assert.equal(flagFor("TOO_EARLY_BY_CODE", checked(item, "SUPPORTED_NOW")), "CODE_ONLY");
  assert.equal(flagFor("TOO_EARLY_BY_CODE", checked(item, "INSUFFICIENT_EVIDENCE")), "CODE_ONLY");
  assert.equal(flagFor("PASSES_CODE", checked(item)), null);
  const held = checked(item); held.result = { ...held.result, action: "HOLD_FOR_REVIEW" };
  assert.equal(flagFor("TOO_EARLY_BY_CODE", held), "CODE_ONLY");
});

test("a cycle bounds concurrent lookups, reads each proposal once, sorts flags first, and sums flagged USDC only", async () => {
  const ps = await proposals([raw("early-a"), raw("early-b"), ...Array.from({ length: 6 }, (_, i) => raw(`pass-${i}`, "2026-11-14T12:15:00Z"))]);
  const cache = new Map<string, DeskCheck>(); const calls = new Map<string, number>(); let active = 0; let max = 0;
  const fetchers: CycleFetchers = { proposals: async () => ps,
    gamma: async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 1)); active--; return market; }, evidence: async () => null,
    saved: async (p) => ({ read: cache.has(p.proposal_id), check: cache.get(p.proposal_id) ?? null }),
    check: async (item) => { calls.set(item.proposal.proposal_id, (calls.get(item.proposal.proposal_id) ?? 0) + 1); const result = checked(item, item.proposal.raw.id === "early-b" ? "SUPPORTED_NOW" : item.screening.screen === "PASSES_CODE" ? "SUPPORTED_NOW" : "NOT_SUPPORTED_NOW"); cache.set(item.proposal.proposal_id, result); return result; } };
  const snapshot = await runDeskCycle(fetchers, { sample: 1, cap: 3 }, () => now);
  assert.ok(max <= 4); assert.equal(max, 4); assert.equal(snapshot.totals.serv_calls, 3); assert.equal(snapshot.totals.flagged, 1);
  assert.equal(snapshot.bond_at_risk_usdc, 250); assert.equal(snapshot.items[0]!.flag, "LIKELY_TOO_EARLY"); assert.equal(snapshot.items[1]!.flag, "CODE_ONLY");
  assert.match(snapshot.items[0]!.wording!, /looks too early under the rules; verify before acting/u);
  assert.equal((await runDeskCycle(fetchers, { sample: 1, cap: 3 }, () => now)).totals.serv_calls, 1);
  assert.ok([...calls.values()].every((n) => n === 1)); assert.equal(bondUsdc({ ...raw("unknown"), currency: "unknown" }), null);
  assert.equal(bondUsdc({ ...raw("500"), bond: "500000000" }), 500);
});

test("history records first flags once and only confirmed same-proposal onchain outcomes", async () => {
  const ps = await proposals([raw("flag")]);
  const fetchers: CycleFetchers = { proposals: async () => ps, gamma: async () => market, evidence: async () => null, saved: async () => ({ read: false, check: null }), check: async (item) => checked(item) };
  const snapshot = await runDeskCycle(fetchers, {}, () => now);
  const history = recordFlags([], snapshot); assert.equal(recordFlags(history, snapshot).length, 1);
  assert.deepEqual(updateHistory(history, [], new Date(now).toISOString()), history);
  const later = { ...raw("flag"), state: "Settled", disputeTimestamp: "123", settlementTimestamp: "456" };
  const outcomes = [{ deployment: ps[0]!.deployment, raw: later }];
  const updated = updateHistory(history, outcomes, "2026-11-14T15:00:00Z");
  assert.equal(updated[0]!.outcome, "disputed"); assert.deepEqual(historySummary(updated).disputed_of_resolved, { count: 1, total: 1 });
  assert.equal(updateHistory(history, [{ ...outcomes[0]!, raw: { ...later, disputeTimestamp: null } }], "later")[0]!.outcome, "settled");
  assert.equal(updateHistory(history, [{ ...outcomes[0]!, raw: { ...later, proposalHash: "replacement" } }], "later")[0]!.outcome, null);
  assert.equal(updateHistory(history, [{ ...outcomes[0]!, raw: { ...later, proposalLogIndex: "2" } }], "later")[0]!.outcome, null);
  const many = Array.from({ length: 2100 }, (_, i) => ({ ...history[0]!, proposal_id: `old-${i}` }));
  assert.equal(recordFlags(many, snapshot).length, 2000);
  assert.equal(updated[0]!.first_flagged_at, snapshot.generated_at);
});

test("the shared SERV slots enforce 3 seconds across interactive and queued work", async () => {
  let clock = 0; const waits: number[] = [];
  const slots = new ServSlots(() => clock, async (ms) => { waits.push(ms); clock += ms; });
  slots.reserve(); assert.throws(() => slots.reserve(), /every 3 seconds/u);
  await slots.wait(); assert.deepEqual(waits, [3000]); assert.equal(clock, 3000);
  clock += 3000; slots.reserve(); await slots.wait(); assert.equal(clock, 9000);
});

test("runtime cycles do not overlap, persist bounded snapshots/history, and mark snapshots stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "k3-desk-")); let clock = now; let calls = 0; let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const fetchers: CycleFetchers = { proposals: async () => { calls++; await waiting; return []; }, gamma: async () => null, evidence: async () => null,
    saved: async () => ({ read: false, check: null }), check: async () => null };
  const desk = new LiveDesk(root, () => clock, { fetchers });
  try {
    const loading = desk.load(); const a = desk.cycle(); const b = desk.cycle(); release(); await loading;
    assert.deepEqual(await a, await b); assert.equal(calls, 1); assert.equal(desk.latest().stale, false);
    clock += desk.interval * 3 + 1; assert.equal(desk.latest().stale, true); assert.equal(desk.latest().age_ms, desk.interval * 3 + 1);
    assert.equal(JSON.parse(await readFile(join(root, "snapshot.json"), "utf8")).items.length, 0);
    assert.equal((await readFile(join(root, "history.jsonl"), "utf8")).trim(), "");
  } finally { await desk.close(); await rm(root, { recursive: true, force: true }); }
});
