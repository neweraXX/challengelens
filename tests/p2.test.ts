import assert from "node:assert/strict";
import test from "node:test";
import { caseAction, eventMarker, humanAction, humanizeDecisions, inputsAt, sealedRuns, selectFlagship } from "../src/demo/evidence.js";
import type { SealedEvidence, ShowcaseCase } from "../src/demo/types.js";
import type { Evidence } from "../src/evidence/as-of.js";
import { evaluateGate } from "../src/gate/decide.js";

const finished = "2025-09-17T03:36:14.500Z";
const sports: Evidence = { kind: "sports_feed", source: "polymarket_gamma_event", event_id: "fixture", slug: "fixture", ended: true, finished_utc: finished, score: "5-0", period: "FT", fetched_at: "2026-01-01T00:00:00Z" };
function replay(title = "Bitcoin above $85,000?"): ShowcaseCase {
  const rules = "This market resolves to Yes if the close of the Binance 1 minute candle for BTCUSDT on March 9, 2025 at 3:30 AM in the ET timezone is above $85,000. Otherwise No.";
  return { case_id: `fixture-${title}`, packet_hash: "fixture", event_group: "fixture", title, category: "crypto_fixed_time", fixed_time_kind: "crypto_candle", rules_text: rules,
    proposal_time_utc: "2025-03-09T08:00:00.000Z", dispute_time_utc: null, settlement_time_utc: null, settlement_label: "TOO_EARLY", settlement_value: null, settlement_tx_hash: null, bond: null, reward: null, currency: null, request_id: "fixture", proposal_tx_hash: null,
    gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: {}, events: [] },
    model_inputs: { title, rules_text: rules, proposal_time_utc: "2025-03-09T08:00:00.000Z", proposed_value: "0", gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: {}, events: [] } },
    verdict: { decision: "SUPPORTED_NOW", reason: null, decisive_time_utc: "2025-03-09T07:31:00Z", checks: { timing: { status: "PASS", clause_quote: "price", explanation: "Fixture" } } }, clause_offsets: { start: 0, end: 1 }, raw_verdict: null, raw_run: null, rules_time_utc: null, gamma_time_utc: null, early_needs_evidence: false };
}
function game(title = "MLB: Braves vs Nationals"): ShowcaseCase {
  const item = replay(title);
  return { ...item, category: "sports_in_game", fixed_time_kind: "sports_scheduled", evidence: sports,
    model_inputs: { ...item.model_inputs, title, rules_text: "Winner of this MLB game." }, game_finished_utc: finished };
}
function run(procedure: string, blind?: boolean): SealedEvidence {
  return { procedure_version: procedure, procedure_sha256: procedure, gate_version: "fixture", date: procedure === "old" ? "2025-01-01T00:00:00Z" : "2026-01-01T00:00:00Z", models: {}, status: "finished", unit: "cases", arms: [], ...(blind === undefined ? {} : { blind }) };
}

test("humanAction covers all actions, formats UTC waits, and never invents a deadline", () => {
  assert.equal(humanAction("PROCEED"), "Proceed"); assert.equal(humanAction("WAIT"), "Wait");
  assert.equal(humanAction("NEED_EVIDENCE"), "Need evidence"); assert.equal(humanAction("HOLD_FOR_REVIEW"), "Held for independent review");
  assert.equal(humanAction("WAIT", "2025-09-17T03:36:00Z"), "Wait until Sep 17, 03:36 UTC");
  assert.equal(humanAction("WAIT", "invalid"), "Wait"); assert.equal(humanAction("unknown"), "Need evidence");
  assert.equal(humanizeDecisions("PROCEED / HOLD_FOR_REVIEW / NEED_EVIDENCE"), "Proceed / Held for independent review / Need evidence");
});
test("flagship prefers Braves with a real finish, otherwise crypto with a deterministic template", () => {
  const crypto = replay(); const braves = game(); const unsupported = { ...braves, evidence: null, game_finished_utc: null };
  assert.equal(selectFlagship([crypto, unsupported, braves]), braves);
  assert.equal(selectFlagship([unsupported, crypto]), crypto);
  assert.equal(selectFlagship([{ ...braves, serv_called: false }, crypto]), crypto);
  const unsupportedOnly = { ...replay("Unknown market"), model_inputs: { ...crypto.model_inputs, title: "Unknown market", rules_text: "No observation time is specified." } };
  assert.equal(selectFlagship([unsupportedOnly, unsupported]), undefined);
  assert.equal(selectFlagship([]), undefined);
});
test("sealed loader accepts legacy object and arrays, orders blind first, preserves second-look notes", () => {
  const legacy = run("old"); assert.equal(sealedRuns(legacy)[0]!.blind, true); assert.equal(legacy.blind, undefined);
  const blind = run("old", true); const second = { ...run("new", false), note: "Second look, not blind" };
  const source = [second, blind]; const rows = sealedRuns(source);
  assert.equal(rows[0]!.procedure_version, "old"); assert.equal(rows[1]!.blind, false); assert.equal(rows[1]!.note, second.note);
  assert.equal(source[0], second); assert.deepEqual(sealedRuns(null), []); assert.deepEqual(sealedRuns([]), []);
});
test("local dragging re-filters sports evidence and drops stale positive evidence without raw facts", () => {
  const item = game();
  const before = inputsAt(item, "2025-09-17T03:00:00.000Z").evidence_as_of_proposal;
  assert.deepEqual(before, { game_finished: false, feed_final_delay_minutes: (Date.parse(finished) - Date.parse("2025-09-17T03:00:00.000Z")) / 60_000, source: "polymarket_gamma_event" });
  assert.deepEqual(inputsAt(item, finished).evidence_as_of_proposal, { game_finished: true, finished_utc: finished, source: "polymarket_gamma_event" });
  const onlySaved = { ...item, evidence: null, model_inputs: { ...item.model_inputs, evidence_as_of_proposal: { game_finished: true as const, finished_utc: finished, source: "polymarket_gamma_event" as const } } };
  assert.equal(inputsAt(onlySaved, "2025-09-17T01:00:00Z").evidence_as_of_proposal, undefined);
  assert.equal(inputsAt(onlySaved, onlySaved.proposal_time_utc).evidence_as_of_proposal?.source, "polymarket_gamma_event");
});
test("price timeline uses touching candle close, and gate still blocks the earlier proposal", () => {
  const item = replay("Will Solana reach $250 September 15-21?");
  item.model_inputs = { ...item.model_inputs, title: item.title, proposed_value: "1000000000000000000", rules_text: "Binance final High of a 1-minute candle between September 15, 2025 at 12:00 AM ET and September 21, 2025 at 11:59 PM ET." };
  item.evidence = { kind: "price_touch", source: "binance_klines_1m", symbol: "SOLUSDT", target: 250, direction: "high", window_start_utc: "2025-09-15T04:00:00Z", scanned_until_utc: "2025-09-22T04:00:00Z", first_touch_utc: "2025-09-17T16:49:59.999Z", candles_scanned: 100 };
  const before = "2025-09-17T16:49:44Z"; const after = "2025-09-17T16:50:00Z";
  const verdict = { ...item.verdict, decisive_time_utc: item.evidence.first_touch_utc };
  assert.equal(evaluateGate(inputsAt(item, before), verdict).action, "WAIT");
  assert.equal(evaluateGate(inputsAt(item, after), verdict).action, "PROCEED");
  assert.equal(eventMarker(item)?.time, item.evidence.first_touch_utc); assert.equal(eventMarker(item)?.label, "First touch (Binance 1m candle)");
  assert.equal(eventMarker(game())?.label, "Game finished (Polymarket sports feed)");
});
test("saved authoritative action takes precedence over a locally derived approval", () => {
  const item = replay(); assert.equal(caseAction(item), "PROCEED");
  assert.equal(caseAction({ ...item, action: "HOLD_FOR_REVIEW" }), "HOLD_FOR_REVIEW");
  assert.equal(caseAction({ ...item, action: "NEED_EVIDENCE" }), "NEED_EVIDENCE");
});
