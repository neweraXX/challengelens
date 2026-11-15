import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { confirmSealed, reserveSealed, sealedAggregates, wilson } from "../scripts/sealed-support.js";
import { armOrder, groupBenchmarkModels, humanDecision, humanizeDecisions, outcomeBuckets } from "../src/demo/evidence.js";
import type { BenchmarkArm, BenchmarkModel } from "../src/demo/types.js";
import type { CaseLabel } from "../src/packets/types.js";
import type { SavedInput } from "../src/gate/eval.js";
import type { Trial } from "../src/judge/run-arm.js";

test("Wilson intervals match reference endpoints and reject invalid counts", () => {
  const zero = wilson(0, 15); assert.ok(Math.abs(zero.low!) < 1e-15); assert.ok(Math.abs(zero.high! - 0.20388330103584862) < 1e-12);
  const half = wilson(5, 10); assert.ok(Math.abs(half.low! - 0.236593090512564) < 1e-12); assert.ok(Math.abs(half.high! - 0.763406909487436) < 1e-12);
  const all = wilson(15, 15); assert.ok(Math.abs(all.low! - 0.7961166989641514) < 1e-12); assert.equal(all.high, 1);
  assert.deepEqual(wilson(0, 0), { count: 0, total: 0, low: null, high: null });
  for (const pair of [[-1, 2], [3, 2], [1.5, 2], [0, -1]]) assert.throws(() => wilson(pair[0]!, pair[1]!));
});

test("sealed confirmation requires exact current fingerprint, never a version or prefix", () => {
  const sha = "a".repeat(64);
  for (const value of [undefined, "", "timing-v5", sha.slice(0, 12), `${sha}\n`, "b".repeat(64)]) assert.throws(() => confirmSealed(value, sha), { message: `Sealed evaluation requires SEALED_CONFIRM=${sha}` });
  assert.doesNotThrow(() => confirmSealed(sha, sha));
});

test("one-shot guard reserves atomically and rejects both empty and completed prior runs", async (t) => {
  const root = await mkdtemp(join(process.env.P1_TEST_TMPDIR ?? tmpdir(), "challengelens-one-shot-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  const sha = "a".repeat(64); const outcomes = await Promise.allSettled([reserveSealed(root, sha), reserveSealed(root, sha)]);
  assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
  await assert.rejects(reserveSealed(root, sha), /One-shot guard/u);
  await writeFile(join(root, sha.slice(0, 12), "results.json"), "{}");
  await assert.rejects(reserveSealed(root, sha), /One-shot guard/u);
  await assert.rejects(reserveSealed(root, "../bad"), /Invalid procedure/u);
});

test("human decisions consistently map every visible decision enum", () => {
  assert.equal(humanDecision("SUPPORTED_NOW"), "Approved");
  assert.equal(humanDecision("NOT_SUPPORTED_NOW"), "Blocked: too early");
  assert.equal(humanDecision("INSUFFICIENT_EVIDENCE"), "Held: needs evidence");
  assert.equal(humanDecision("unexpected"), "Needs review");
  assert.equal(humanizeDecisions("NOT_SUPPORTED_NOW / SUPPORTED_NOW / INSUFFICIENT_EVIDENCE"), "Blocked: too early / Approved / Held: needs evidence");
});

const metric: BenchmarkArm = { trials: 45, valid: 44, correct: 27, false_supported: 0, premature_trials: 24, abstained: 17, consistent_cases: 15, cases: 15, tokens: 100, cost_usd: null };
function model(run: string, procedure = "procedure-a", name = "model-a"): BenchmarkModel {
  return { model: name, run, procedure, source: "fixture", rows: { raw: null, serv: null, "raw+gate": null, "serv+gate": null } };
}
test("benchmark merges complementary model/procedure runs without mixing procedures or double-counting", () => {
  const raw = model("first"); raw.rows.raw = metric; raw.rows["raw+gate"] = metric;
  const serv = model("second"); serv.rows.serv = metric; serv.rows["serv+gate"] = metric;
  const repeat = model("third"); repeat.rows.raw = { ...metric, correct: 1 };
  const result = groupBenchmarkModels([raw, serv, repeat, model("old", "older"), model("other", "procedure-a", "model-b")]);
  assert.equal(result.length, 3); assert.deepEqual(result[0]!.runs, ["first", "second", "third"]);
  for (const arm of armOrder.filter((a) => a !== "checks-only")) assert.equal(result[0]!.rows[arm]?.correct, 27);
  assert.equal(raw.rows.serv, null); // Input remains untouched.
});

test("outcome stacks preserve unscored checks and do not double-count correct abstentions", () => {
  assert.deepEqual(outcomeBuckets(metric), { correct: 27, abstained: 17, safe: 0, dangerous: 0, unscored: 1 });
  const values = outcomeBuckets({ ...metric, correct_abstained: 3 });
  assert.equal(values.abstained, 14); assert.equal(values.safe, 3);
  assert.equal(Object.values(values).reduce((a, b) => a + b), 45);
});

test("sealed reports count case majorities, not repeated trials, and preserve partial costs", () => {
  const input: SavedInput = { case_id: "fixture-case", packet_hash: "fixture-hash", model_inputs: { title: "Bitcoin fixed observation", rules_text: "Use Bitcoin price at 12:00 PM UTC on December 8, 2026.", proposal_time_utc: "2026-12-08T11:00:00Z", proposed_value: "0", gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: {}, events: [] } } };
  const label: CaseLabel = { case_id: input.case_id, packet_hash: input.packet_hash, label: "PREMATURE", expected_decision: "NOT_SUPPORTED_NOW", expected_reason: "PREMATURE", outcome_flipped: false, settlement_price: "unused", source: "ORACLE_SETTLEMENT_TIMING_PROXY", receipt_verified: false };
  const make = (repetition: number, approve: boolean): Trial => ({ arm: "serv", case_id: input.case_id, packet_hash: input.packet_hash, repetition, status: "valid", claimed_decision: null, errors: [],
    verdict: { decision: approve ? "SUPPORTED_NOW" : "NOT_SUPPORTED_NOW", reason: approve ? null : "PREMATURE", decisive_time_utc: "2026-12-08T12:00:00Z", checks: { timing: { status: approve ? "PASS" : "FAIL", clause_quote: "Use Bitcoin price at 12:00 PM UTC on December 8, 2026.", explanation: "Fixture" } } },
    attempts: [{ started_at: "2026-11-13T00:00:00Z", request_format: "json_schema", http_status: 200, latency_ms: 1, network_error: null, usage: { prompt: 1, completion: 1, total: 2, cost_usd: repetition === 1 ? 0.1 : null } }] });
  const trials = [make(1, true), make(2, true), make(3, false)];
  const results = sealedAggregates([input], trials, new Map([[input.case_id, label]]), ["serv"]);
  assert.equal(results[0]!.false_approvals.count, 1); assert.equal(results[0]!.false_approvals.total, 1);
  assert.equal(results[0]!.correct.count, 0); assert.equal(results[0]!.consistency.count, 0);
  assert.equal(results[1]!.false_approvals.count, 0); assert.equal(results[1]!.false_approvals.total, 1);
  assert.equal(results[0]!.tokens, 6); assert.equal(results[1]!.tokens, 6);
  assert.equal(results[0]!.recorded_cost_usd, 0.1); assert.equal(results[0]!.cost_complete, false);
  const empty = sealedAggregates([input], [], new Map([[input.case_id, label]]), ["serv"])[0]!;
  assert.equal(empty.completed_cases, 0); assert.equal(empty.correct.total, 0); assert.equal(empty.consistency.total, 1);
  assert.ok(!JSON.stringify(results).includes(input.case_id)); assert.ok(!JSON.stringify(results).includes(input.model_inputs.rules_text));
  assert.throws(() => sealedAggregates([input], [...trials, trials[0]!], new Map([[input.case_id, label]]), ["serv"]), /duplicate/u);
});
