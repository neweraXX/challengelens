import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { cutoff, sportsStart, sportsTiming, zonedUtc } from "../src/gate/cutoff.js";
import type { Cutoff } from "../src/gate/cutoff.js";
import { decide, evaluateGate } from "../src/gate/decide.js";
import { gatedMetrics } from "../src/gate/eval.js";
import { cacheKey, createReceipt, persistReceipt, readReceipt, receiptHash } from "../src/gate/receipt.js";
import { PROCEDURE_SHA256, SYSTEM_PROMPT } from "../src/judge/prompt.js";
import { VERDICT_SCHEMA } from "../src/judge/schema.js";
import type { Verdict } from "../src/judge/schema.js";
import { canonicalJson, sha256 } from "../src/packets/canonical.js";
import type { ModelInputs, CaseLabel } from "../src/packets/types.js";

const inputs = (title: string, rules_text: string, market: Record<string, string> = {}): ModelInputs => ({ title, rules_text,
  proposed_value: "0", proposal_time_utc: "2025-03-10T00:00:00.000Z", gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market, events: [] } });
const verdict = (decisive_time_utc: string | null, decision: Verdict["decision"] = "SUPPORTED_NOW"): Verdict => ({ decision,
  decisive_time_utc, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null,
  checks: { timing: { status: decision === "SUPPORTED_NOW" ? "PASS" : decision === "NOT_SUPPORTED_NOW" ? "FAIL" : "UNKNOWN", clause_quote: "price", explanation: "Timing comparison." } } });
const code: Cutoff = { template: "crypto_instant", cutoff_utc: "2025-03-09T16:00:00.000Z", matched_text: "price", notes: [] };

test("ET/PT conversions use the offset on March and November dates", () => {
  assert.equal(zonedUtc(2025, 3, 9, 1, 30, "ET"), "2025-03-09T06:30:00.000Z");
  assert.equal(zonedUtc(2025, 3, 9, 3, 30, "ET"), "2025-03-09T07:30:00.000Z");
  assert.equal(zonedUtc(2025, 11, 2, 0, 30, "ET"), "2025-11-02T04:30:00.000Z");
  assert.equal(zonedUtc(2025, 11, 2, 2, 30, "ET"), "2025-11-02T07:30:00.000Z");
  assert.equal(zonedUtc(2025, 3, 9, 3, 30, "PT"), "2025-03-09T10:30:00.000Z");
  assert.equal(zonedUtc(2025, 11, 2, 2, 30, "PT"), "2025-11-02T10:30:00.000Z");
  assert.equal(zonedUtc(2025, 3, 9, 2, 30, "ET"), null);
  assert.equal(zonedUtc(2025, 11, 2, 1, 30, "ET"), null);
  assert.equal(zonedUtc(2025, 2, 30, 12, 0, "ET"), null);
});
test("Binance 1 minute candle closes one minute after its label", () => {
  const result = cutoff(inputs("Bitcoin above $85,000?", 'This market resolves to Yes if the close of the Binance 1 minute candle for BTCUSDT on March 9, 2025 at 3:30 AM in the ET timezone is above $85,000. Otherwise No.'));
  assert.equal(result?.template, "crypto_candle_1m");
  assert.equal(result?.cutoff_utc, "2025-03-09T07:31:00.000Z");
});
test("hourly and daily Up or Down use interval ends, including a DST day", () => {
  const hourly = cutoff(inputs("Bitcoin Up or Down - November 2, 2025, 2:00 AM ET", "This market uses the hourly candle that begins at the time and date in the title."));
  assert.equal(hourly?.template, "crypto_candle_interval");
  assert.equal(hourly?.cutoff_utc, "2025-11-02T08:00:00.000Z");
  const daily = cutoff(inputs("Ethereum Up or Down - March 8, 2025, 12:00 PM ET", "This market uses the daily candle that begins at the time and date in the title."));
  assert.equal(daily?.cutoff_utc, "2025-03-09T16:00:00.000Z");
});
test("crypto instant parses a stated price clock and infers one unambiguous Gamma year", () => {
  const instant = cutoff(inputs("Bitcoin above $90,000?", "This market resolves based on the price of Bitcoin at November 3, 2025, 12:00 PM PT."));
  assert.equal(instant?.template, "crypto_instant");
  assert.equal(instant?.cutoff_utc, "2025-11-03T20:00:00.000Z");
  assert.equal(cutoff(inputs("Bitcoin above $90,000?", "The price at March 10 at 12:00 PM ET determines resolution.", { endDate: "2025-03-10T00:00:00Z" }))?.cutoff_utc, "2025-03-10T16:00:00.000Z");
});
test("observation window uses B, including the inclusive 11:59 PM minute", () => {
  const rules = 'This market resolves to Yes if the United States initiates a military attack between December 14, 12:00 PM ET, and December 31, 2023, 11:59 PM ET. Otherwise No.';
  const result = cutoff(inputs("Will US attack Yemen in 2023?", rules));
  assert.equal(result?.template, "observation_window");
  assert.equal(result?.cutoff_utc, "2024-01-01T05:00:00.000Z");
  const midday = cutoff(inputs("Will the event occur?", "This market resolves to Yes if the event occurs between March 10, 2025 at 10:00 AM ET and March 10, 2025 at 12:00 PM ET."));
  assert.equal(midday?.cutoff_utc, "2025-03-10T16:00:00.000Z");
});
test("unvetted or ambiguous text has no independent cutoff", () => {
  assert.equal(cutoff(inputs("Bitcoin above $90,000?", "The price at March 10 at 12:00 PM ET determines resolution.")), null);
  assert.equal(cutoff(inputs("Bitcoin above $90,000 in 2024 or in 2025?", "The price at March 10 at 12:00 PM ET determines resolution.")), null);
  assert.equal(cutoff(inputs("Bitcoin above $90,000?", "The price at November 2, 2025 at 1:30 AM ET determines resolution.")), null);
  assert.equal(cutoff(inputs("Bitcoin above $90,000?", "The price at March 10, 2025 at 12:00 PM ET with a publication delay of 10 minutes determines resolution.")), null);
  assert.equal(cutoff(inputs("Bitcoin above $2025?", "The price at March 10 at 12:00 PM ET determines resolution.")), null);
  assert.equal(cutoff(inputs("Bitcoin above $90,000 on March 10, 2025 at 12:00 PM ET?", "The price at March 10, 2025 at 12:00 PM ET or March 11, 2025 at 12:00 PM ET determines resolution.")), null);
  assert.equal(cutoff(inputs("Will a politician win?", "Resolve after the election.")), null);
});
test("gate-v3 cutoff truth table: tolerance, equality, one key, abstention and disagreement", () => {
  const rows: [string | null, string, Cutoff | null, Verdict["decision"], string, string][] = [
    [code.cutoff_utc, "2025-03-09T15:59:59Z", code, "NOT_SUPPORTED_NOW", "AGREE", "before cutoff"],
    [code.cutoff_utc, code.cutoff_utc, code, "SUPPORTED_NOW", "AGREE", "both cutoffs passed"],
    ["2025-03-09T16:02:00Z", "2025-03-09T16:01:00Z", code, "NOT_SUPPORTED_NOW", "AGREE", "before cutoff"],
    ["2025-03-09T16:02:00Z", "2025-03-09T16:02:00Z", code, "SUPPORTED_NOW", "AGREE", "both cutoffs passed"],
    ["2025-03-09T16:03:00Z", "2025-03-09T16:01:00Z", code, "NOT_SUPPORTED_NOW", "DISAGREE", "keys disagree"],
    ["2025-03-09T15:57:00Z", "2025-03-09T15:58:00Z", code, "NOT_SUPPORTED_NOW", "DISAGREE", "keys disagree"],
    ["2025-03-09T16:03:00Z", "2025-03-09T17:00:00Z", code, "INSUFFICIENT_EVIDENCE", "DISAGREE", "keys disagree"],
    [code.cutoff_utc, "2025-03-09T17:00:00Z", null, "INSUFFICIENT_EVIDENCE", "SERV_ONLY", "no independent cutoff"],
    [code.cutoff_utc, "2025-03-09T15:00:00Z", null, "NOT_SUPPORTED_NOW", "SERV_ONLY", "before cutoff"],
    [null, "2025-03-09T15:00:00Z", code, "NOT_SUPPORTED_NOW", "CODE_ONLY", "before cutoff"],
    [null, "2025-03-09T17:00:00Z", code, "INSUFFICIENT_EVIDENCE", "CODE_ONLY", "no usable SERV cutoff"],
    [null, "2025-03-09T17:00:00Z", null, "INSUFFICIENT_EVIDENCE", "NA", "no independent cutoff"],
  ];
  for (const [s, p, c, expected, agreement, reason] of rows) {
    const result = decide(verdict(s), c, p, "0");
    assert.equal(result.final_decision, expected, JSON.stringify([s, p]));
    assert.equal(result.gate.agreement, agreement);
    assert.equal(result.gate.gate_reason, reason);
    if (reason === "keys disagree" && expected === "NOT_SUPPORTED_NOW") assert.equal(result.final_reason, "BLOCKED_DISAGREEMENT");
  }
  assert.equal(decide(verdict(code.cutoff_utc, "INSUFFICIENT_EVIDENCE"), code, "2025-03-09T17:00:00Z", "0").final_decision, "INSUFFICIENT_EVIDENCE");
});
test("a SERV-only premature verdict is retained without inventing a cutoff", () => {
  const result = decide(verdict(null, "NOT_SUPPORTED_NOW"), null, "2025-03-09T17:00:00Z", "0");
  assert.equal(result.final_decision, "NOT_SUPPORTED_NOW");
  assert.equal(result.gate.gate_reason, "SERV-only premature verdict");
});
test("asymmetric early YES remains insufficient evidence even when the keys disagree", () => {
  const result = decide(verdict("2025-03-09T15:57:00Z"), code, "2025-03-09T15:58:00Z", "1000000000000000000", { earlyYes: true });
  assert.equal(result.final_decision, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.gate.gate_reason, "early YES needs event evidence");
});
test("sports requires both starts before a WAIT; duration estimates never decide timing", () => {
  const sport = inputs("Braves vs Mets", "This MLB game is scheduled for September 16, 2025 at 1:00 PM ET. Postponed games stay open until completed.", { gameStartTime: "2025-09-16T19:00:00Z", startDate: "2025-01-01T00:00:00Z" });
  assert.equal(cutoff(sport), null);
  assert.equal(sportsStart(sport), "2025-09-16T19:00:00.000Z");
  const timing = sportsTiming(sport);
  assert.equal(timing.duration_hours, 6);
  assert.equal(timing.estimated_end_utc, "2025-09-17T01:00:00.000Z");
  for (const [p, decision, reason] of [
    ["2025-09-16T16:59:00Z", "NOT_SUPPORTED_NOW", "before sports start"],
    ["2025-09-16T18:59:00Z", "INSUFFICIENT_EVIDENCE", "schedule sources conflict"],
    ["2025-09-16T19:00:00Z", "INSUFFICIENT_EVIDENCE", "needs proof the game finished"],
    ["2025-09-17T01:00:00Z", "INSUFFICIENT_EVIDENCE", "needs proof the game finished"],
    ["2025-09-20T00:00:00Z", "INSUFFICIENT_EVIDENCE", "needs proof the game finished"],
  ]) {
    const result = evaluateGate({ ...sport, proposal_time_utc: p! }, verdict("2025-09-16T22:00:00Z"));
    assert.equal(result.final_decision, decision);
    assert.equal(result.gate.gate_reason, reason);
  }
  const earlierGamma = { ...sport, gamma_scheduling: { ...sport.gamma_scheduling, market: { gameStartTime: "2025-09-16T15:00:00Z" } } };
  assert.equal(sportsStart(earlierGamma), "2025-09-16T17:00:00.000Z");
});
test("receipt hash covers canonical content and persists with integrity verification", async () => {
  const body = { ...decide(verdict(code.cutoff_utc), code, code.cutoff_utc, "0"), packet_hash: "a".repeat(64), case_id: "case-1", market_id: "123",
    proposal_time_utc: code.cutoff_utc, model: "test-model", serv_request_id: "serv-123", serv_verdict: verdict(code.cutoff_utc) };
  const receipt = createReceipt(body, { receipt_id: "12345678-1234-1234-1234-123456789012", created_at: "2025-03-09T17:00:00Z" });
  const reversed = Object.fromEntries(Object.entries(receipt).reverse()) as typeof receipt;
  assert.equal(receiptHash(reversed), receipt.receipt_sha256);
  assert.notEqual(receiptHash({ ...receipt, model: "different" }), receipt.receipt_sha256);
  assert.equal(PROCEDURE_SHA256, sha256(canonicalJson({ system_prompt: SYSTEM_PROMPT, schema: VERDICT_SCHEMA })));
  assert.notEqual(cacheKey(body.packet_hash, body.proposal_time_utc, "a"), cacheKey(body.packet_hash, body.proposal_time_utc, "b"));
  const directory = await mkdtemp(join(tmpdir(), "gate-receipt-test-"));
  try { await persistReceipt(receipt, directory); assert.deepEqual(await readReceipt(receipt.receipt_id, directory), receipt); assert.equal(await readReceipt("../escape", directory), null); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
test("offline gated metrics keep invalid trials invalid and list abstention reasons", () => {
  const input = { case_id: "case-1", packet_hash: "hash", model_inputs: inputs("Unsupported", "Unknown clock") };
  const label: CaseLabel = { case_id: input.case_id, packet_hash: input.packet_hash, label: "PREMATURE", expected_decision: "NOT_SUPPORTED_NOW", expected_reason: "PREMATURE", outcome_flipped: false, settlement_price: "0", source: "ORACLE_SETTLEMENT_TIMING_PROXY", receipt_verified: false };
  const metrics = gatedMetrics([input], [{ ...input, arm: "serv", repetition: 1, status: "valid", verdict: verdict(code.cutoff_utc) }, { ...input, arm: "serv", repetition: 2, status: "invalid", verdict: verdict(code.cutoff_utc) }], new Map([[label.case_id, label]]));
  assert.equal(metrics.arms[1]!.false_supported, 0);
  assert.equal(metrics.arms[1]!.abstentions_by_gate_reason["no independent cutoff"], 1);
  assert.equal(metrics.arms[1]!.invalid, 1);
});
