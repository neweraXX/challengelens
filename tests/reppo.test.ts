import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutoff } from "../src/gate/cutoff.js";
import { decide, evaluateGate } from "../src/gate/decide.js";
import { appendReppo, createReceipt, persistReceipt, readReceipt, receiptHash } from "../src/gate/receipt.js";
import { formatReppoInput } from "../src/reppo/format.js";
import type { ReviewInput } from "../src/reppo/format.js";
import { HOLD_STATUS, reviewPolicy } from "../src/reppo/policy.js";
import { MAX_INPUT_BYTES, ReppoClient, ReppoError } from "../src/reppo/client.js";
import type { ReppoEvaluation } from "../src/reppo/client.js";
import { SecondOpinions } from "../src/reppo/service.js";
import { procedureChange } from "../src/reppo/changes.js";
import type { ModelInputs } from "../src/packets/types.js";
import type { Verdict } from "../src/judge/schema.js";

const inputs: ModelInputs = { title: "Will Bitcoin be above $95,000 on November 14?", rules_text: 'This market will resolve to Yes if the close price of the Binance 1 minute candle for BTC/USDT 12:00 in the ET timezone (noon) on the date specified in the title is higher than $95,000. Otherwise No.',
  proposed_value: "1000000000000000000", proposal_time_utc: "2026-11-13T20:00:00.000Z", gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: { id: "6801787", endDate: "2026-11-14T17:00:00Z", startDate: "2026-11-01T00:00:00Z" }, events: [] } };
const serv = (decision: Verdict["decision"] = "SUPPORTED_NOW", time: string | null = "2026-11-14T17:01:00.000Z"): Verdict => ({ decision, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null, decisive_time_utc: time,
  checks: { timing: { status: decision === "SUPPORTED_NOW" ? "PASS" : decision === "NOT_SUPPORTED_NOW" ? "FAIL" : "UNKNOWN", clause_quote: "Binance 1 minute candle", explanation: "The observation ends at the stated candle close." } } });
const context = (): ReviewInput => ({ ...evaluateGate(inputs, serv()), model_inputs: inputs, serv_verdict: serv() });
const done = (id = "eval-test"): ReppoEvaluation => ({ id, status: "COMPLETED", score: 25, route: "block", result: { decision: "reject", confidence: "high", reason: "The proposed check is before the candle closes.", rubric_scores: { timing: 20 }, consensus: {}, explain: "Timing mismatch." }, trace: [{ evaluator: "one", reason: "Before close." }], creditsCharged: 440 });
function receipt() { return createReceipt({ ...evaluateGate(inputs, serv()), packet_hash: "b".repeat(64), case_id: "timing-test", market_id: "6801787", proposal_time_utc: inputs.proposal_time_utc, model: "test", serv_request_id: "serv-test", serv_verdict: serv() }); }

test("exact Binance title-date wording obtains year from Gamma and adds one minute", () => {
  assert.equal(cutoff(inputs)?.template, "crypto_candle_1m");
  assert.equal(cutoff(inputs)?.cutoff_utc, "2026-11-14T17:01:00.000Z");
  const noDatePhrase = { ...inputs, rules_text: 'The Binance 1 minute candle for BTC/USDT 12:00 in the ET timezone (noon) determines resolution.' };
  assert.equal(cutoff(noDatePhrase)?.cutoff_utc, "2026-11-14T17:01:00.000Z");
  assert.equal(cutoff({ ...inputs, title: "Bitcoin on November 14 or November 15?" }), null);
  assert.equal(cutoff({ ...inputs, gamma_scheduling: { ...inputs.gamma_scheduling, market: { endDate: "2026-11-14", startDate: "2025-12-01" } } }), null);
  assert.equal(cutoff({ ...inputs, gamma_scheduling: { ...inputs.gamma_scheduling, market: {} } }), null);
  assert.equal(cutoff({ ...inputs, rules_text: inputs.rules_text.replace("(noon)", "(midnight)") }), null);
});
test("instant and Up or Down combine a title date with an unambiguous rules clock", () => {
  const instant = { ...inputs, rules_text: 'The price of Bitcoin at 12:00 in the ET timezone (noon) on the date specified in the title determines resolution.' };
  assert.equal(cutoff(instant)?.template, "crypto_instant");
  assert.equal(cutoff(instant)?.cutoff_utc, "2026-11-14T17:00:00.000Z");
  const priceTitle = "Will the price of Bitcoin be above $95,000 on November 14?";
  assert.equal(cutoff({ ...instant, title: priceTitle, rules_text: `${priceTitle}\n\n${instant.rules_text}` })?.cutoff_utc, "2026-11-14T17:00:00.000Z");
  const hourly = { ...inputs, title: "Bitcoin Up or Down - November 14", rules_text: 'The hourly candle begins at 12:00 PM ET on the date specified in the title.' };
  assert.equal(cutoff(hourly)?.cutoff_utc, "2026-11-14T18:00:00.000Z");
  assert.equal(cutoff({ ...hourly, rules_text: hourly.rules_text.replace("hourly", "daily") })?.cutoff_utc, "2026-11-15T17:00:00.000Z");
  assert.equal(cutoff({ ...instant, rules_text: instant.rules_text.replace("12:00", "12:00 or 13:00") }), null);
});
test("SERV self-consistency compares PASS/FAIL against its own cutoff, preserving original drag time", () => {
  assert.equal(evaluateGate(inputs, serv()).gate.serv_self_inconsistent, true);
  assert.equal(evaluateGate(inputs, serv("NOT_SUPPORTED_NOW")).gate.serv_self_inconsistent, false);
  const after = { ...inputs, proposal_time_utc: "2026-11-14T18:00:00Z" };
  assert.equal(evaluateGate(after, serv("NOT_SUPPORTED_NOW")).gate.serv_self_inconsistent, true);
  assert.equal(evaluateGate(after, serv()).gate.serv_self_inconsistent, false);
  assert.equal(evaluateGate(inputs, serv("INSUFFICIENT_EVIDENCE")).gate.serv_self_inconsistent, false);
  assert.equal(evaluateGate(inputs, serv("SUPPORTED_NOW", null)).gate.serv_self_inconsistent, false);
  assert.equal(evaluateGate(inputs, serv(), after.proposal_time_utc).gate.serv_self_inconsistent, false);
  assert.equal(decide(serv(), cutoff(inputs), inputs.proposal_time_utc, inputs.proposed_value).final_decision, "NOT_SUPPORTED_NOW");
});
test("Reppo format includes both audit parts, exact rules when small, and a strict UTF-8 byte cap", () => {
  const base = formatReppoInput(context());
  assert.match(base, /User prompt/u); assert.match(base, /AI response/u); assert.ok(base.includes(inputs.rules_text));
  assert.ok(base.includes("Is this proposal decidable now under these rules? Quote the governing clause."));
  assert.match(base, /serv_self_inconsistent/u);
  const large = context(); large.model_inputs = { ...inputs, rules_text: "汉😀".repeat(50_000) };
  large.serv_verdict = serv(); large.serv_verdict.checks.timing.clause_quote = "\u0000".repeat(30_000);
  const text = formatReppoInput(large);
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_INPUT_BYTES); assert.match(text, /TRUNCATED/u); assert.ok(!text.includes("�"));
});
test("one-directional review policy truth table never upgrades a non-green verdict", () => {
  for (const decision of ["SUPPORTED_NOW", "NOT_SUPPORTED_NOW", "INSUFFICIENT_EVIDENCE"] as const) {
    for (const route of ["ship", "review", "block"] as const) for (const panel of ["accept", "reject"] as const) {
      const result = reviewPolicy(decision, { route, decision: panel, score: 69 });
      assert.equal(result.held, decision === "SUPPORTED_NOW" && (route === "block" || panel === "reject" || route === "review"));
      assert.equal(result.final_decision, result.held ? "INSUFFICIENT_EVIDENCE" : decision);
      assert.equal(result.action, result.held ? "HOLD_FOR_REVIEW" : decision === "SUPPORTED_NOW" ? "PROCEED" : decision === "NOT_SUPPORTED_NOW" ? "WAIT" : "NEED_EVIDENCE");
      assert.equal(result.display_status, result.held ? HOLD_STATUS : decision);
    }
    assert.equal(reviewPolicy(decision, null).display_status, decision);
  }
});
test("client submits taskType response and polls every five seconds with no real HTTP", async () => {
  const prior = process.env.REPPO_API_KEY; process.env.REPPO_API_KEY = "unit-test-key";
  try {
    let now = 0; const waits: number[] = []; let gets = 0;
    const client = new ReppoClient({ now: () => now, wait: async (ms) => { waits.push(ms); now += ms; }, transport: async (url, init) => {
      assert.equal(new URL(url).host, "eval.reppo.xyz");
      assert.equal(init.headers.authorization, "Bearer unit-test-key");
      if (init.method === "POST") { assert.equal(JSON.parse(init.body!).taskType, "response"); return { status: 201, text: async () => JSON.stringify({ id: "eval-test", status: "QUEUED" }) }; }
      gets += 1; return { status: 200, text: async () => JSON.stringify(gets === 1 ? { id: "eval-test", status: "PROCESSING" } : done()) };
    } });
    await client.submit("audit"); const result = await client.poll("eval-test");
    assert.equal(result.status, "COMPLETED"); assert.deepEqual(waits, [5000, 5000]);
    await assert.rejects(client.submit("x".repeat(MAX_INPUT_BYTES + 1)), /50 KB/u);
    let submitted = 0;
    const failed = new ReppoClient({ transport: async () => { submitted += 1; return { status: 502, text: async () => "unit-test-key" }; } });
    await assert.rejects(failed.submit("audit"), (e: unknown) => e instanceof ReppoError && e.notQueued && !e.message.includes("unit-test-key"));
    assert.equal(submitted, 1);
    let timeoutNow = 0;
    const pending = new ReppoClient({ now: () => timeoutNow, wait: async (ms) => { timeoutNow += ms; }, transport: async () => ({ status: 200, text: async () => JSON.stringify({ id: "eval-test", status: "QUEUED" }) }) });
    await assert.rejects(pending.poll("eval-test"), (e: unknown) => e instanceof ReppoError && e.status === 504);
    assert.equal(timeoutNow, 180_000);
  } finally { if (prior === undefined) delete process.env.REPPO_API_KEY; else process.env.REPPO_API_KEY = prior; }
});
test("receipt review appends a newly hashed extension; stale cache writes preserve it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "challengelens-receipt-reppo-"));
  try {
    const base = receipt(); await persistReceipt(base, directory);
    const reviewed = await appendReppo(base.receipt_id, { eval_id: "eval-test", score: 25, route: "block", decision: "reject", confidence: "high", reason: "Before close", completed_at: new Date().toISOString(), evaluated_receipt_sha256: base.receipt_sha256 }, directory);
    assert.notEqual(reviewed.receipt_sha256, base.receipt_sha256); assert.equal(receiptHash(reviewed), reviewed.receipt_sha256);
    await persistReceipt(base, directory);
    assert.deepEqual(await readReceipt(base.receipt_id, directory), reviewed);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("service caches by the original receipt digest, survives restart, rate limits and caps new submissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "challengelens-reppo-service-")); const cache = join(root, "reppo"); const receipts = join(root, "receipts");
  try {
    const base = receipt(); await persistReceipt(base, receipts); let calls = 0;
    const fake = { submit: async () => { calls += 1; return done(); }, get: async () => done(), poll: async () => done() };
    const service = new SecondOpinions(cache, receipts, () => fake, 1);
    await Promise.all([service.submit(base, context()), service.submit(base, context())]); assert.equal(calls, 1);
    const extended = (await readReceipt(base.receipt_id, receipts))!;
    await new SecondOpinions(cache, receipts, () => fake, 1).submit(extended, context()); assert.equal(calls, 1);
    await unlink(join(cache, `receipt-${base.receipt_sha256}.json`));
    await new SecondOpinions(cache, receipts, () => fake, 1).submit(extended, context()); assert.equal(calls, 1);
    const other = receipt(); await persistReceipt(other, receipts);
    await assert.rejects(service.submit(other, context()), (e: unknown) => e instanceof ReppoError && e.status === 429 && /20 seconds/u.test(e.message));
    const ledger = JSON.parse(await readFile(join(cache, "ledger.json"), "utf8")); ledger.last_submission_at = Date.now() - 21_000; await writeFile(join(cache, "ledger.json"), JSON.stringify(ledger));
    await assert.rejects(service.submit(other, context()), /Daily Reppo/u); assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("an uncertain POST can never be paid for again automatically", async () => {
  const root = await mkdtemp(join(tmpdir(), "challengelens-reppo-uncertain-"));
  try {
    const base = receipt(); const receipts = join(root, "receipts"); await persistReceipt(base, receipts); let calls = 0;
    const fake = { submit: async (): Promise<ReppoEvaluation> => { calls += 1; throw new ReppoError("Submission outcome unknown"); }, get: async () => done(), poll: async () => done() };
    const service = new SecondOpinions(join(root, "cache"), receipts, () => fake);
    await assert.rejects(service.submit(base, context()));
    await assert.rejects(service.submit(base, context()), /reconciled/u); assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("change records require an explicit accepted/rejected outcome and retain rejected critiques", () => {
  const base = { from_version: "timing-v4", to_version: "timing-v5", reppo_eval_ids: ["eval-test"], critique_summary: "Check the cutoff", change: "Proposed change", dev_before: { correct: 27 }, dev_after: { correct: 25 }, accepted: false };
  assert.equal(procedureChange(base).accepted, false);
  assert.throws(() => procedureChange({ ...base, accepted: undefined }));
});
