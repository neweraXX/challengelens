import test from "node:test";
import assert from "node:assert/strict";
import { proceedNeeds, describeNeeds } from "../src/gate/needs.js";
import { decide } from "../src/gate/decide.js";
import { createReceipt } from "../src/gate/receipt.js";
import type { Verdict } from "../src/judge/schema.js";

test("needs use one vocabulary for missing facts, reading, approval, waits and review holds", () => {
  const gate = { template: null, gate_reason: "no independent cutoff", code_cutoff_utc: null };
  assert.deepEqual(proceedNeeds({ action: "PROCEED", gate }), []);
  assert.deepEqual(proceedNeeds({ action: "NEED_EVIDENCE", gate }), ["NEED_CUTOFF_READING"]);
  assert.deepEqual(proceedNeeds({ action: "NEED_EVIDENCE", gate: { ...gate, template: "sports", gate_reason: "needs proof the game finished" } }), ["NEED_GAME_FINAL"]);
  assert.deepEqual(proceedNeeds({ action: "WAIT", gate: { ...gate, template: "sports", gate_reason: "game not finished at proposal time (sports feed)", evidence: { game_finished: false } } }), ["NEED_GAME_FINAL"]);
  assert.deepEqual(proceedNeeds({ action: "NEED_EVIDENCE", gate: { ...gate, gate_reason: "early YES needs event evidence" } }), ["NEED_EVENT_OCCURRED"]);
  assert.deepEqual(proceedNeeds({ action: "WAIT", gate: { ...gate, gate_reason: "event had not occurred at proposal time (price scan)" } }), ["NEED_EVENT_OCCURRED"]);
  assert.deepEqual(proceedNeeds({ action: "NEED_EVIDENCE", gate: { ...gate, template: "sports", gate_reason: "SERV did not approve", evidence: { game_finished: true } } }), ["NEED_SERV_APPROVAL"]);
  assert.deepEqual(proceedNeeds({ action: "HOLD_FOR_REVIEW", gate }), ["NEED_REVIEW_CLEARANCE"]);
  const earliest_utc = "2026-11-14T12:01:00.000Z";
  const needs = proceedNeeds({ action: "WAIT", earliest_utc, gate: { ...gate, gate_reason: "before cutoff", code_cutoff_utc: earliest_utc } });
  assert.deepEqual(needs, ["WAIT_UNTIL"]);
  assert.deepEqual(describeNeeds(needs, earliest_utc), [{ code: "WAIT_UNTIL", text: `Wait until ${earliest_utc}, then check again`, earliest_utc }]);
  for (const code of ["NEED_GAME_FINAL", "NEED_EVENT_OCCURRED", "NEED_CUTOFF_READING", "NEED_SERV_APPROVAL", "WAIT_UNTIL", "NEED_REVIEW_CLEARANCE"]) assert.ok(describeNeeds([code])[0]!.text.length > 20);
});

test("new gate outputs and hashed receipts include needs plus human descriptions", () => {
  const serv: Verdict = { decision: "NOT_SUPPORTED_NOW", reason: "PREMATURE", decisive_time_utc: "2026-11-14T12:01:00Z", sports: null,
    checks: { timing: { status: "FAIL", clause_quote: "price", explanation: "The proposal is before candle close." } } };
  const result = decide(serv, { template: "crypto_candle_1m", cutoff_utc: serv.decisive_time_utc!, matched_text: "price", notes: [] }, "2026-11-14T12:00:00Z", "0");
  assert.deepEqual(result.needs, ["WAIT_UNTIL"]); assert.equal(result.need_details?.[0]!.earliest_utc, result.earliest_utc);
  const receipt = createReceipt({ ...result, packet_hash: "hash", case_id: "fixture", market_id: null, model: "fixture", proposal_time_utc: "2026-11-14T12:00:00Z", serv_request_id: null, serv_verdict: serv });
  assert.deepEqual(receipt.needs, result.needs); assert.deepEqual(receipt.need_details, result.need_details);
});
