import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate, evaluateChecksOnly, GATE_VERSION } from "../src/gate/decide.js";
import { cutoff, zonedUtc } from "../src/gate/cutoff.js";
import { localClockUtc } from "../src/gate/serv-time.js";
import { asOf, FEED_NEGATIVE_MARGIN_MS } from "../src/evidence/as-of.js";
import { sportsEvidence } from "../src/evidence/sports.js";
import { parsePriceWindow, scanPrice } from "../src/evidence/price.js";
import { attachEvidence } from "../src/evidence/collect.js";
import { assertModelInputs } from "../src/judge/dev-data.js";
import { SYSTEM_PROMPT, PROCEDURE_VERSION } from "../src/judge/prompt.js";
import { validateVerdict } from "../src/judge/validate.js";
import { fetchLiveProposals, proposalPacket, screenProposal, flagFor, contemporaneous, runDeskCycle, selectServ } from "../src/live/desk.js";
import { checkIdentity, matchesCheck, LiveDesk } from "../src/live/runtime.js";
import { gatedMetrics, servChanges, gateMetricsMarkdown } from "../src/gate/eval.js";
import { sealedAggregates, sealedSplit, reserveSealed } from "../scripts/sealed-support.js";
import { selectHoldout2 } from "../src/packets/holdout2.js";
import { inputHash } from "../src/packets/canonical.js";
import { createReceipt, persistReceipt, readReceipt } from "../src/gate/receipt.js";
import { ADAPTERS } from "../config/adapters.js";
import type { ModelInputs, LabeledCase, CaseLabel } from "../src/packets/types.js";
import type { Verdict, DecisiveLocal } from "../src/judge/schema.js";
import type { SportsEvidence } from "../src/evidence/sports.js";
import type { PriceEvidence } from "../src/evidence/price.js";
import type { OracleRequest } from "../src/collect/types.js";
import type { DeskCheck, Prepared, Proposal } from "../src/live/desk.js";
import type { Trial } from "../src/judge/run-arm.js";

const p = "2026-07-01T18:00:00Z";
const ms = Date.parse(p);
const utc = (offset: number) => new Date(ms + offset).toISOString();
const input = (title = "Bitcoin price", rules_text = "Use Bitcoin price at July 1, 2026 at 12:00 PM UTC.", proposed_value: ModelInputs["proposed_value"] = "0"): ModelInputs => ({ title, rules_text, proposed_value, proposal_time_utc: p,
  gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: {}, events: [] } });
function serv(decision: Verdict["decision"] = "SUPPORTED_NOW", time: string | null = null): Verdict {
  return { decision, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null, decisive_time_utc: time, sports: null,
    checks: { timing: { status: decision === "SUPPORTED_NOW" ? "PASS" : decision === "NOT_SUPPORTED_NOW" ? "FAIL" : "UNKNOWN", clause_quote: "price", explanation: "Fixture observation comparison." } } };
}
const game = (rules = "The winner of this MLB game scheduled for July 1, 2026 at 12:00 PM UTC determines resolution.") => input("MLB: A vs B", rules);
const feed: SportsEvidence = { kind: "sports_feed", source: "polymarket_gamma_event", event_id: "fixture", slug: "fixture", ended: false, finished_utc: null, period: "1", score: "1-0", fetched_at: utc(31 * 60_000) };

test("K5 A1: estimates cannot produce WAIT; both schedules must be future, conflicts abstain", () => {
  const bothFuture = { ...game(), proposal_time_utc: utc(-7 * 3_600_000), gamma_scheduling: { ...game().gamma_scheduling, market: { gameStartTime: utc(-5 * 3_600_000) } } };
  assert.equal(evaluateGate(bothFuture, serv("NOT_SUPPORTED_NOW")).action, "WAIT");
  for (const offset of [-5 * 3_600_000, -1, 0, 24 * 3_600_000]) {
    const result = evaluateGate({ ...game(), proposal_time_utc: utc(offset) }, serv("NOT_SUPPORTED_NOW", utc(99_000_000)));
    assert.equal(result.action, "NEED_EVIDENCE"); assert.deepEqual(result.needs, ["NEED_GAME_FINAL"]);
    assert.equal(result.gate.code_cutoff_utc, null);
  }
  for (const [ruleHour, gamma] of [[12, utc(3_600_000)], [20, utc(-3_600_000)]] as const) {
    const g = game(`Winner of this MLB game scheduled for July 1, 2026 at ${ruleHour}:00 UTC.`);
    g.gamma_scheduling.market.gameStartTime = gamma;
    const result = evaluateGate(g, serv()); assert.equal(result.action, "NEED_EVIDENCE"); assert.equal(result.gate.gate_reason, "schedule sources conflict");
  }
  const partial = evaluateGate(game("First half of this MLB game scheduled for July 1, 2026 at 12:00 PM UTC."), serv());
  assert.deepEqual(partial.needs, ["NEED_PERIOD_FINAL"]);
  const over = evaluateGate({ ...input("MLB total over 8 points", "The MLB game is scheduled for July 1, 2026 at 12:00 PM UTC.", "1000000000000000000") }, serv());
  assert.deepEqual(over.needs, ["NEED_EVENT_OCCURRED"]);
});

test("K5 A2/A3: 30-minute inference boundary, live period requirement, factual reason, contradictions", () => {
  assert.equal(FEED_NEGATIVE_MARGIN_MS, 1_800_000);
  for (const delay of [1, 15 * 60_000, FEED_NEGATIVE_MARGIN_MS]) {
    assert.equal(asOf({ ...feed, ended: true, finished_utc: utc(delay) }, p), undefined);
    assert.equal(asOf({ ...feed, fetched_at: utc(delay) }, p), undefined);
  }
  const final = { ...feed, ended: true, finished_utc: utc(31 * 60_000) };
  const view = asOf(final, p)!;
  assert.deepEqual(view, { game_finished: false, feed_final_delay_minutes: 31, source: feed.source });
  assert.equal(evaluateGate({ ...game(), evidence_as_of_proposal: view }, serv()).gate.gate_reason, "feed marked the game final 31 min after the proposal (negative inference)");
  assert.doesNotThrow(() => assertModelInputs({ ...game(), evidence_as_of_proposal: view }));
  assert.equal((asOf(feed, p) as { game_finished: boolean }).game_finished, false);
  for (const period of [null, "FT", "Final", "scheduled", "postponed", "0"]) assert.equal(asOf({ ...feed, period }, p), undefined);
  for (const event of [
    { ended: false, finishedTimestamp: p }, { ended: true, finishedTimestamp: "bad" },
    { ended: true, finishedTimestamp: p, startTime: utc(1) }, { ended: false, startTime: "bad" },
  ]) assert.equal(sportsEvidence(event, p), null);
  assert.equal(sportsEvidence({ ended: false }, "bad"), null);
  assert.ok(sportsEvidence({ ended: true, finishedTimestamp: p, startTime: utc(-1) }, p));
});

const priceInput = () => ({ ...input("Will Solana reach $250 July 1-7?", 'This market will resolve to "Yes" if any Binance 1-minute candle has a final "High" of $250 or more during the date range specified in the title (from 12:00 AM ET on the first date to 11:59 PM ET on the last).', "1000000000000000000"), gamma_scheduling: { ...input().gamma_scheduling, market: { endDate: "2026-07-08T04:00:00Z" } } });
test("K5 A4: final High/Low waits for close; ordinary touch is unknown inside that minute", async () => {
  const inputs = priceInput(); const window = parsePriceWindow(inputs)!;
  assert.equal(window.final_high_low, true);
  const open = Date.parse(window.window_start_utc);
  const result = await scanPrice(window, new Date(open + 3_600_000).toISOString(), async (url) => {
    const span = new URL(url).searchParams.get("interval") === "1h" ? 3_600_000 : 60_000;
    return [[open, "240", "251", "230", "240", "0", open + span - 1]];
  }, async () => {});
  const close = result.first_touch_utc!;
  const inside = new Date(Date.parse(close) - 15_000).toISOString();
  assert.equal((asOf(result, inside) as { event_occurred: boolean }).event_occurred, false);
  assert.equal((asOf(result, close) as { event_occurred: boolean }).event_occurred, true);
  assert.equal(asOf({ ...result, touch_semantics: "intracandle_unknown" }, inside), undefined);
  assert.equal(asOf(result, inside, "Use Binance intraday prices."), undefined);
  // Saved legacy scans are interpreted from the packet's actual rules.
  const { touch_semantics: _old, ...legacy } = result;
  const packet = { case_id: "fixture", packet_hash: "hash", model_inputs: { ...inputs, proposal_time_utc: inside } };
  assert.equal((attachEvidence([packet], [{ case_id: "fixture", packet_hash: "hash", evidence: legacy, error: null }])[0]!.model_inputs.evidence_as_of_proposal as { event_occurred: boolean }).event_occurred, false);
  const lowRules = inputs.rules_text.replace('"High"', '"Low"');
  assert.equal(parsePriceWindow({ ...inputs, title: "Will Solana dip to $250 July 1-7?", rules_text: lowRules })?.final_high_low, true);
});

test("K5 A5: fixed EST/EDT/PST/PDT stay fixed during summer and DST folds", () => {
  const offsets = { EST: 17, EDT: 16, PST: 20, PDT: 19, ET: 16, PT: 19 } as const;
  for (const [timezone, hour] of Object.entries(offsets)) {
    const local: DecisiveLocal = { date: "2026-07-01", time: "12:00", timezone: timezone as DecisiveLocal["timezone"], adjust_minutes: 0 };
    assert.equal(localClockUtc(local), `2026-07-01T${hour}:00:00.000Z`);
    assert.ok(validateVerdict({ ...serv(), decisive_local: local }, "price", { requireDecisiveLocal: true }).verdict);
    assert.equal(cutoff(input(undefined, `Use Bitcoin price at July 1, 2026 at 12:00 PM ${timezone}.`))?.cutoff_utc, `2026-07-01T${hour}:00:00.000Z`);
    assert.equal(cutoff(input(undefined, `Use the Binance 1-minute candle at July 1, 2026 at 12:00 PM ${timezone}.`))?.cutoff_utc, `2026-07-01T${hour}:01:00.000Z`);
  }
  assert.equal(zonedUtc(2026, 11, 1, 1, 30, "EST"), "2026-11-01T06:30:00.000Z");
  assert.equal(zonedUtc(2026, 11, 1, 1, 30, "ET"), null);
  assert.match(SYSTEM_PROMPT, /Copy the zone token exactly as written/u);
  assert.equal(PROCEDURE_VERSION, "timing-v8"); assert.equal(GATE_VERSION, "gate-v8");
});

function raw(id: string): OracleRequest {
  return { id, requester: ADAPTERS[0].address, identifier: "YES_OR_NO_QUERY", time: "1", ancillaryData: `0x${Buffer.from('q: title: MLB A vs B, description: Winner of this MLB game scheduled for July 1, 2026 at 12:00 PM UTC., market_id: 123').toString("hex")}`,
    proposer: "fixture", proposedPrice: "0", disputer: null, state: "Proposed", requestTimestamp: "1", requestBlockNumber: "1", requestHash: "0xrequest", requestLogIndex: "0",
    proposalTimestamp: String(ms / 1000), proposalBlockNumber: "1", proposalHash: `0x${id}`, proposalLogIndex: "1", proposalExpirationTimestamp: String(ms / 1000 + 7200),
    disputeTimestamp: null, disputeHash: null, settlementPrice: null, settlementTimestamp: null, settlementHash: null, currency: "USDC", bond: "1", finalFee: "0", reward: "0", customLiveness: "7200", eventBased: false };
}
async function prepared(): Promise<Prepared> {
  const proposals = await fetchLiveProposals(async (d) => d.name === "managed-oov2" ? [raw("fixture")] : [], ms + 1);
  const proposal = proposals[0]!; const packet = proposalPacket(proposal, null, utc(1));
  return { proposal, packet, evidence: feed, screening: screenProposal(packet, feed) };
}
test("K5 A6: query filters expiry, pagination exhausts or exposes cap and per-deployment counts", async () => {
  let calls = 0;
  const rows = await fetchLiveProposals(async (d, query, v) => {
    calls++; assert.match(query, /proposalExpirationTimestamp_gt: \$now/u); assert.equal(v.now, String((ms + 1000) / 1000));
    return Array.from({ length: Number(v.first) }, (_, i) => raw(`${d.name}-${v.skip}-${i}`));
  }, ms + 1000);
  assert.equal(rows.length, 800); assert.equal(calls, 4); assert.equal(rows.collection!.truncated, true);
  assert.ok(Object.values(rows.collection!.deployments).every((d) => d.fetched === 400 && d.accepted === 400 && d.truncated));
  const small = await fetchLiveProposals(async () => [], ms + 1000); assert.equal(small.collection!.truncated, false);
  const item = await prepared();
  const snapshot = await runDeskCycle({ proposals: async () => rows, gamma: async () => null, evidence: async () => null, saved: async () => ({ read: false, check: null }), check: async () => null }, { cap: 0 }, () => ms + 1000);
  assert.equal(snapshot.totals.truncated, true); assert.equal(snapshot.totals.in_liveness, 800);
  assert.equal(snapshot.totals.source_age_seconds!.subgraph, 0); assert.equal(snapshot.totals.detection_delay_seconds, 1);
  assert.ok(item.packet.fixed_time);
});

test("K5 A7: changed packet/evidence invalidates cached checks; flags require contemporaneous evidence", async () => {
  const item = await prepared(); const identity = checkIdentity(item);
  assert.equal(matchesCheck({ state: "complete", ...identity }, item), true);
  assert.equal(matchesCheck({ state: "complete", ...identity, packet_hash: "different" }, item), false);
  assert.equal(matchesCheck({ state: "error", ...identity, evidence_hash: "different" }, item), false);
  assert.equal(matchesCheck({ state: "reserved" }, item), false);
  assert.equal(matchesCheck({ state: "complete", ...identity }, { ...item, evidence: { ...feed, ended: true, finished_utc: utc(-1) } }), false);
  const verdict = serv("NOT_SUPPORTED_NOW"); const view = asOf(feed, p)!;
  const checked: DeskCheck = { verdict, result: evaluateGate({ ...item.packet.model_inputs, evidence_as_of_proposal: view }, verdict), receipt_id: "fixture" };
  const historical = { ...item, evidence: { ...feed, ended: true, period: "FT", finished_utc: utc(31 * 60_000) } };
  assert.equal(contemporaneous(historical, null), false);
  assert.equal(flagFor("TOO_EARLY_BY_CODE", checked, contemporaneous(historical, null)), "CODE_ONLY");
  assert.equal(contemporaneous(item, null), true);
  assert.equal(flagFor("TOO_EARLY_BY_CODE", checked, contemporaneous(item, null)), "LIKELY_TOO_EARLY");
  assert.equal(contemporaneous({ ...historical }, { fetched_at: utc(1), ended: false, period: "Q1", score: "0-0" }), true);
  assert.equal(contemporaneous(historical, { fetched_at: utc(-1), ended: false, period: "Q1", score: "0-0" }), false);
  const fixed = { ...item, packet: { ...item.packet, model_inputs: input(undefined, undefined, "0") } };
  assert.equal(contemporaneous(fixed, null), true);
});

test("K5 A7/A9: first feed snapshot survives cycles/restart; export contains reviewer facts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "k5-live-")); t.after(() => rm(root, { recursive: true, force: true }));
  const item = await prepared(); let clock = ms + 31 * 60_000; let evidence: SportsEvidence = feed;
  const fetchers = { proposals: async () => [item.proposal], gamma: async () => null, evidence: async () => evidence, saved: async () => ({ read: false, check: null }), check: async () => null };
  let desk = new LiveDesk(root, () => clock, { fetchers });
  await desk.cycle(); await desk.close();
  evidence = { ...feed, fetched_at: utc(40 * 60_000), ended: true, period: "FT", finished_utc: utc(39 * 60_000) }; clock = ms + 40 * 60_000;
  desk = new LiveDesk(root, () => clock, { fetchers }); t.after(() => desk.close());
  const snapshot = await desk.cycle(); const bundle = await desk.exportProposal(item.proposal.proposal_id);
  assert.deepEqual(bundle!.first_seen, { fetched_at: feed.fetched_at, ended: false, period: "1", score: "1-0" });
  assert.equal(bundle!.rules_text, item.proposal.rules_text); assert.equal(bundle!.tx_hash, item.proposal.raw.proposalHash);
  assert.equal(bundle!.evidence!.kind, "sports_feed"); assert.equal(bundle!.serv_receipt, null);
  assert.equal(snapshot.totals.detection_delay_seconds, 31 * 60); assert.equal(await desk.exportProposal("unknown"), null);
  assert.ok(JSON.parse(await readFile(join(root, "observations.json"), "utf8"))[item.proposal.proposal_id]);
});

test("K5 A8: real Solana price range NO has end cutoff; YES always needs touch evidence", () => {
  const yes = priceInput(); const no = { ...yes, proposed_value: "0" as const, proposal_time_utc: "2026-07-08T04:00:00Z" };
  assert.equal(cutoff(no)?.template, "observation_window"); assert.equal(cutoff(no)?.cutoff_utc, "2026-07-08T04:00:00.000Z");
  assert.equal(evaluateGate(no, serv()).action, "PROCEED");
  assert.equal(evaluateGate(no, serv("SUPPORTED_NOW", p)).action, "PROCEED");
  assert.equal(evaluateGate({ ...no, proposal_time_utc: "2026-07-08T03:59:59.999Z" }, serv()).action, "WAIT");
  assert.equal(evaluateGate(no, serv("INSUFFICIENT_EVIDENCE")).action, "NEED_EVIDENCE");
  assert.equal(cutoff(yes), null); assert.deepEqual(evaluateGate(yes, serv()).needs, ["NEED_EVENT_OCCURRED"]); assert.equal(evaluateGate({ ...yes, proposal_time_utc: no.proposal_time_utc }, serv()).action, "NEED_EVIDENCE");
  assert.equal(evaluateChecksOnly(no).action, "PROCEED");
});

function labeled(id: string, event_group: string, label: CaseLabel["label"] = "TIMING_OK"): LabeledCase {
  const inputs = input(); const packet_hash = inputHash(inputs);
  return { packet: { schema_version: "timing-packet-1", case_id: id, packet_hash, event_group, category: "crypto_fixed_time", fixed_time: { kind: "crypto_instant", matched_text: "price" }, model_inputs: inputs,
    provenance: { deployment: "fixture", request_id: id, proposal_hash: null, proposal_log_index: null, identity_verified_against_receipts: false, historical_rule_updates_verified: false } },
    label: { case_id: id, packet_hash, label, expected_decision: label === "PREMATURE" ? "NOT_SUPPORTED_NOW" : "SUPPORTED_NOW", expected_reason: label === "PREMATURE" ? "PREMATURE" : null,
      outcome_flipped: false, settlement_price: "unused", source: "ORACLE_SETTLEMENT_TIMING_PROXY", receipt_verified: false } };
}
test("K5 B: checks-only uses no SERV clock/approval; strict/action metrics and delta counts", () => {
  const one = labeled("one", "one"); const inputs = [one.packet]; const labels = new Map([["one", one.label]]);
  const trials: Trial[] = [1, 2, 3].map((repetition) => ({ arm: "serv", case_id: "one", packet_hash: one.packet.packet_hash, repetition, status: "valid", verdict: serv("INSUFFICIENT_EVIDENCE"), claimed_decision: null, attempts: [], errors: [] }));
  const metrics = gatedMetrics(inputs, trials, labels); const offline = metrics.arms.find((a) => a.arm === "checks-only")!;
  assert.equal(evaluateChecksOnly(one.packet.model_inputs).gate.serv_decisive_time_utc, null);
  assert.equal(evaluateChecksOnly(input("Unsupported", "No clock")).action, "NEED_EVIDENCE");
  assert.equal(offline.correct, 3); assert.equal(offline.action_metrics["Proceed coverage"].count, 1);
  assert.equal(metrics.serv_changes.serv_blocked_checks_proceed, 1); assert.equal(metrics.serv_changes.serv_enabled_without_checks, 0);
  assert.match(gateMetricsMarkdown(metrics), /checks-only/u);
  const aggregates = sealedAggregates(inputs, trials, labels, ["serv"]); const a = aggregates.find((a) => a.arm === "checks-only")!;
  assert.equal(a.correct.count, 1); assert.equal(a.tokens, 0); assert.equal(a.attempts, 0); assert.equal(a.recorded_cost_usd, 0); assert.equal(a.cost_complete, true);
  assert.ok(!JSON.stringify(metrics.serv_changes).includes("one"));
  const approved = trials.map((r) => ({ ...r, verdict: serv("SUPPORTED_NOW", "2026-07-01T12:00:00Z") }));
  assert.equal(servChanges(inputs, approved).serv_enabled_without_checks, 0);
});

test("K5 C: holdout excludes exposed IDs AND entire dev/sealed/showcase event groups", () => {
  const pool = [labeled("dev", "dev"), labeled("dev-sibling", "dev"), labeled("sealed", "sealed"), labeled("sealed-sibling", "sealed"),
    labeled("showcase", "showcase"), labeled("showcase-sibling", "showcase"),
    ...Array.from({ length: 8 }, (_, i) => labeled(`new-${i}`, `group-${Math.floor(i / 4)}`, i % 2 ? "PREMATURE" : "TIMING_OK"))];
  const exposed = [{ case_id: "dev", event_group: "dev" }, { case_id: "sealed", event_group: "sealed" }, { case_id: "showcase" }];
  const result = selectHoldout2(pool, exposed);
  assert.equal(result.selected.length, 4); assert.equal(result.selected.filter((r) => r.label.label === "PREMATURE").length, 2);
  assert.ok(result.selected.every((r) => r.packet.case_id.startsWith("new-")));
  assert.equal(result.exclusions.exposed_case_id, 3); assert.equal(result.exclusions.exposed_event_group, 3); assert.equal(result.exclusions.event_cap, 4);
  assert.deepEqual(selectHoldout2([...pool].reverse(), [...exposed].reverse()), result);
  assert.equal(selectHoldout2(pool, pool.map((r) => r.packet)).selected.length, 0);
  const scarce = selectHoldout2([labeled("a", "a", "PREMATURE"), labeled("b", "b"), labeled("c", "c"), labeled("d", "d")], []);
  assert.equal(scarce.selected.length, 4); // Never discard cases merely to make labels balanced.
});

test("K5 C: one-shot guard is independent per split AND procedure; split traversal is rejected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "k5-guards-")); t.after(() => rm(root, { recursive: true, force: true }));
  const sha = "a".repeat(64);
  assert.equal(sealedSplit(), "sealed"); assert.equal(sealedSplit("sealed2"), "sealed2");
  for (const value of ["dev", "../sealed", "sealed2/other", ""]) assert.throws(() => sealedSplit(value));
  const first = await reserveSealed(root, sha, "sealed"); const second = await reserveSealed(root, sha, "sealed2");
  assert.notEqual(first, second); await assert.rejects(reserveSealed(root, sha, "sealed2"), /One-shot guard/u);
  assert.notEqual(await reserveSealed(root, "b".repeat(64), "sealed2"), second);
});

test("K5 A7: receipt cache checks both hashes, preserves the old receipt, and respects cycle cap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "k5-receipts-")); t.after(() => rm(root, { recursive: true, force: true }));
  const item = await prepared(); const verdict = serv("NOT_SUPPORTED_NOW");
  const result = evaluateGate({ ...item.packet.model_inputs, evidence_as_of_proposal: asOf(feed, p)! }, verdict);
  const receipt = createReceipt({ ...result, packet_hash: item.packet.packet_hash, case_id: item.proposal.proposal_id,
    market_id: null, proposal_time_utc: p, model: "fixture", serv_request_id: null, serv_verdict: verdict });
  await persistReceipt(receipt); t.after(() => rm(join(".cache/receipts", `${receipt.receipt_id}.json`), { force: true }));
  const desk = new LiveDesk(root, () => ms + 31 * 60_000, { fetchers: { proposals: async () => [], gamma: async () => null, evidence: async () => null, saved: async () => ({ read: false, check: null }), check: async () => null } });
  await desk.load(); t.after(() => desk.close());
  const privateDesk = desk as unknown as { checkPath(p: Proposal): string; saved(p: Proposal, item: Prepared): Promise<{ read: boolean; check: DeskCheck | null }> };
  const path = privateDesk.checkPath(item.proposal);
  await writeFile(path, JSON.stringify({ state: "complete", ...checkIdentity(item), check: { result: receipt, verdict, receipt_id: receipt.receipt_id } }));
  assert.equal((await privateDesk.saved(item.proposal, item)).read, true);
  const changed = { ...item, evidence: { ...feed, ended: true, finished_utc: utc(-1) } };
  assert.deepEqual(await privateDesk.saved(item.proposal, changed), { read: false, check: null, reread: true });
  assert.equal((await readReceipt(receipt.receipt_id))!.receipt_sha256, receipt.receipt_sha256);
  assert.equal(selectServ([{ screen: "NO_DETERMINISTIC_KEY" as const, read: false, reread: true }], 0, 1).length, 1);
  let calls = 0;
  const fetchers = { proposals: async () => [item.proposal], gamma: async () => null, evidence: async () => changed.evidence,
    saved: (p: Proposal, prepared?: Prepared) => privateDesk.saved(p, prepared!), check: async () => { calls++; return null; } };
  const snapshot = await runDeskCycle(fetchers, { sample: 10, cap: 0 }, () => ms + 31 * 60_000);
  assert.equal(calls, 0); assert.equal(snapshot.totals.serv_calls, 0);
  await runDeskCycle(fetchers, { sample: 10, cap: 1 }, () => ms + 31 * 60_000); assert.equal(calls, 1);
});
