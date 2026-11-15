import test from "node:test";
import assert from "node:assert/strict";
import { localClockUtc, servDecisiveUtc } from "../src/gate/serv-time.js";
import { decide, evaluateGate } from "../src/gate/decide.js";
import { gatedTrials } from "../src/gate/eval.js";
import { validateVerdict } from "../src/judge/validate.js";
import { VERDICT_SCHEMA } from "../src/judge/schema.js";
import { runArm } from "../src/judge/run-arm.js";
import type { Trial } from "../src/judge/run-arm.js";
import type { ApiAttempt, CompletionClient } from "../src/judge/client.js";
import type { DecisiveLocal, Verdict } from "../src/judge/schema.js";
import type { CasePacket, ModelInputs } from "../src/packets/types.js";

const empty: DecisiveLocal = { date: null, time: null, timezone: null, adjust_minutes: 0 };
const local = (date: string, time: string, timezone: DecisiveLocal["timezone"] = "ET", adjust_minutes = 1): DecisiveLocal => ({ date, time, timezone, adjust_minutes });
const verdict = (decisive_local?: DecisiveLocal, decisive_time_utc: string | null = "2025-11-07T16:00:00Z"): Verdict => ({
  decision: "SUPPORTED_NOW", reason: null, decisive_time_utc, ...(decisive_local ? { decisive_local } : {}), sports: null,
  checks: { timing: { status: "PASS", clause_quote: "price", explanation: "The proposal is after the governing observation." } },
});
const inputs = (title: string, rules_text: string, proposal_time_utc: string): ModelInputs => ({ title, rules_text, proposal_time_utc, proposed_value: "0",
  gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: { endDate: "2025-11-07T17:00:00Z" }, events: [] } });

test("code converts the two reported SERV clocks, including inclusive/candle minute adjustments", () => {
  const yearEnd = servDecisiveUtc(verdict(local("2023-12-31", "23:59"), "2023-12-31T23:59:00Z"));
  assert.deepEqual(yearEnd, { utc: "2024-01-01T05:00:00.000Z", source: "computed_from_local", model_utc: "2023-12-31T23:59:00Z", mismatch_seconds: 18060 });
  const noon = servDecisiveUtc(verdict(local("2025-11-07", "12:00")));
  assert.equal(noon.utc, "2025-11-07T17:01:00.000Z"); assert.equal(noon.mismatch_seconds, 3660);
});

test("conversion uses March DST offsets, handles PT and preserves an explicitly stated close", () => {
  assert.equal(localClockUtc(local("2025-03-09", "03:30")), "2025-03-09T07:31:00.000Z");
  assert.equal(localClockUtc(local("2025-03-09", "01:30")), "2025-03-09T06:31:00.000Z");
  assert.equal(localClockUtc(local("2025-03-09", "03:30", "PT", 0)), "2025-03-09T10:30:00.000Z");
  assert.equal(localClockUtc(local("2025-11-07", "12:00", "ET", 0)), "2025-11-07T17:00:00.000Z");
});

test("validation rejects impossible, incomplete, ambiguous and malformed local outputs", () => {
  assert.ok(VERDICT_SCHEMA.required.includes("decisive_local"));
  const valid = local("2025-11-07", "12:00");
  assert.ok(validateVerdict(verdict(valid), "price", { requireDecisiveLocal: true }).verdict);
  assert.ok(validateVerdict(verdict(empty), "price", { requireDecisiveLocal: true }).verdict);
  for (const bad of [
    null, { ...valid, date: "2025-02-30" }, { ...valid, date: "2025-02-29" }, { ...valid, date: "2025-13-01" },
    { ...valid, date: "2025-1-01" }, { ...valid, time: "24:00" }, { ...valid, time: "12:60" }, { ...valid, time: "1:00" },
    { ...valid, date: null }, { ...valid, time: null }, { ...valid, timezone: null }, { ...valid, timezone: "CST" },
    { ...valid, adjust_minutes: 0.5 }, { ...valid, adjust_minutes: "1" }, { ...valid, extra: true },
    { date: "2025-11-07", time: "12:00", timezone: "ET" }, { ...empty, adjust_minutes: 1 },
    local("2025-03-09", "02:30"), local("2025-11-02", "01:30"),
  ]) assert.equal(validateVerdict({ ...verdict(), decisive_local: bad }, "price").verdict, null, JSON.stringify(bad));
});

test("legacy validation remains available, while current inference requires the local envelope", () => {
  assert.ok(validateVerdict(verdict(), "price").verdict);
  assert.equal(validateVerdict(verdict(), "price", { requireDecisiveLocal: true }).verdict, null);
  assert.equal(servDecisiveUtc(verdict(local("2025-02-30", "12:00"))).utc, null);
});

test("fresh inference rejects missing decisive_local but accepts the current closed schema", async () => {
  const packet: CasePacket = { schema_version: "timing-packet-1", case_id: "fixture-clock", packet_hash: "hash", event_group: "fixture", category: "crypto_fixed_time",
    model_inputs: inputs("Bitcoin observation", "price", "2025-11-07T18:00:00Z"),
    provenance: { deployment: "fixture", request_id: "fixture", proposal_hash: null, proposal_log_index: null, identity_verified_against_receipts: false, historical_rule_updates_verified: false } };
  for (const [output, expected] of [[verdict(), "invalid"], [verdict(local("2025-11-07", "12:00")), "valid"]] as const) {
    const attempt: ApiAttempt = { started_at: "2025-11-07T18:00:00Z", request_format: "json_schema", http_status: 200, latency_ms: 0, network_error: null,
      usage: { prompt: 0, completion: 0, total: 0 }, response_text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
    const client: CompletionClient = { complete: async (_inputs, save) => { await save(attempt, 1); return { attempts: [attempt], final: attempt }; } };
    const trials: Trial[] = [];
    await runArm("serv", client, [packet], async () => {}, async (trial) => { trials.push(trial); });
    assert.equal(trials.length, 3); assert.ok(trials.every((trial) => trial.status === expected));
  }
});

test("gate-v6 agrees after correcting UTC arithmetic and records both clocks without mutating SERV", () => {
  const cases = [
    { packet: inputs("Will an event occur?", "An event between December 14, 2023 at 12:00 PM ET and December 31, 2023 at 11:59 PM ET determines resolution.", "2024-01-01T06:00:00Z"),
      serv: verdict(local("2023-12-31", "23:59"), "2023-12-31T23:59:00Z"), expected: "2024-01-01T05:00:00.000Z" },
    { packet: inputs("Bitcoin above $95,000 on November 7?", "The price of the Binance 1 minute candle for BTC/USDT 12:00 in the ET timezone (noon) on the date specified in the title determines resolution.", "2025-11-07T18:00:00Z"),
      serv: verdict(local("2025-11-07", "12:00")), expected: "2025-11-07T17:01:00.000Z" },
  ];
  for (const row of cases) {
    const saved = structuredClone(row.serv); const result = evaluateGate(row.packet, row.serv);
    assert.equal(result.gate.version, "gate-v8"); assert.equal(result.action, "PROCEED"); assert.equal(result.gate.agreement, "AGREE");
    assert.equal(result.gate.serv_decisive_time_utc, row.expected); assert.equal(result.gate.serv_time?.model_utc, row.serv.decisive_time_utc);
    assert.equal(result.gate.serv_time?.source, "computed_from_local"); assert.equal(result.gate.serv_clock_corrected, true);
    assert.equal(result.gate.serv_self_inconsistent, false); assert.ok(result.gate.notes.some((s) => /clock corrected/u.test(s)));
    assert.deepEqual(row.serv, saved);
  }
});

test("prematurity, earliest UTC and self-consistency use the computed clock; SERV approval remains required", () => {
  const packet = inputs("Bitcoin above $95,000 on November 7?", "Use the price of the Binance 1 minute candle at November 7, 2025 at 12:00 PM ET.", "2025-11-07T16:30:00Z");
  const serv = verdict(local("2025-11-07", "12:00"));
  const before = evaluateGate(packet, serv);
  assert.equal(before.action, "WAIT"); assert.equal(before.earliest_utc, "2025-11-07T17:01:00.000Z");
  assert.equal(before.gate.serv_self_inconsistent, true);
  assert.equal(evaluateGate(packet, serv, "2025-11-07T18:00:00Z").gate.serv_self_inconsistent, false);
  const declined: Verdict = { ...serv, decision: "NOT_SUPPORTED_NOW", reason: "PREMATURE", checks: { timing: { ...serv.checks.timing, status: "FAIL" } } };
  const after = evaluateGate({ ...packet, proposal_time_utc: "2025-11-07T18:00:00Z" }, declined);
  assert.equal(after.action, "NEED_EVIDENCE"); assert.equal(after.gate.gate_reason, "SERV did not approve"); assert.equal(after.gate.serv_self_inconsistent, true);
});

test("correction note uses a strict greater-than-120-second threshold; absent model estimates still compute", () => {
  const clock = local("2025-11-07", "12:00", "UTC", 0);
  const code = { template: "crypto_instant" as const, cutoff_utc: "2025-11-07T12:00:00Z", matched_text: "price", notes: ["Original note."] };
  for (const [modelUtc, corrected] of [["2025-11-07T11:58:00Z", false], ["2025-11-07T12:02:01Z", true], [null, false]] as const) {
    const result = decide(verdict(clock, modelUtc), code, code.cutoff_utc, "0");
    assert.equal(result.action, "PROCEED"); assert.equal(result.gate.serv_clock_corrected, corrected);
    assert.equal(result.gate.notes.length, corrected ? 2 : 1);
  }
  assert.deepEqual(code.notes, ["Original note."]);
});

test("old runs and evidence-based verdicts fall back to model UTC, including null", () => {
  const utc = "2025-09-17T03:36:14.500Z";
  for (const serv of [verdict(undefined, utc), verdict(empty, utc)]) assert.deepEqual(servDecisiveUtc(serv), { utc, source: "model_utc", model_utc: utc, mismatch_seconds: 0 });
  assert.deepEqual(servDecisiveUtc(verdict(empty, null)), { utc: null, source: null, model_utc: null, mismatch_seconds: null });
  const packet = inputs("Bitcoin fixed observation", "Use the price at November 7, 2025 at 12:00 PM UTC.", "2025-11-07T13:00:00Z");
  const row = { case_id: "legacy", packet_hash: "hash", model_inputs: packet };
  const result = gatedTrials([row], [{ arm: "serv", case_id: row.case_id, packet_hash: row.packet_hash, repetition: 1, status: "valid", verdict: verdict(undefined, "2025-11-07T12:00:00Z") }])[0]!.gated!;
  assert.equal(result.action, "PROCEED"); assert.equal(result.gate.serv_time?.source, "model_utc"); assert.equal(result.gate.serv_clock_corrected, false);
});
