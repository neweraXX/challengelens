import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { archiveB2 } from "../src/packets/archive.js";
import { inputHash } from "../src/packets/canonical.js";
import { selectFixedTime } from "../src/packets/fixed-time.js";
import type { CaseLabel, CasePacket, ModelInputs } from "../src/packets/types.js";
import { CALL_INTERVAL_MS, MODELS, pilotArms, requestBody, responseUsage } from "../src/judge/client.js";
import type { ApiAttempt, CompletionClient } from "../src/judge/client.js";
import { pilotReport } from "../src/judge/report.js";
import { runArm } from "../src/judge/run-arm.js";
import type { Trial } from "../src/judge/run-arm.js";
import { VERDICT_SCHEMA } from "../src/judge/schema.js";
import { normalizeQuote, quoteIsSubstring, validateVerdict } from "../src/judge/validate.js";

const YES = "1000000000000000000";
const NO = "0";

test("quotes normalize typography in both directions, while retaining substring checks", () => {
  const rules = 'The “Warriors” must finish\n\t after 8:00 PM ET; it’s a full-game market.';
  assert.ok(quoteIsSubstring('The "Warriors" must finish after 8:00 PM ET', rules));
  assert.ok(quoteIsSubstring('“Warriors” must finish\n after 8:00 PM ET', normalizeQuote(rules)));
  assert.ok(quoteIsSubstring("it's a full-game market.", rules));
  assert.ok(quoteIsSubstring("Ｗａｒｒｉｏｒｓ", rules));
  for (const quote of ["", " \n ", "warriors", "after 9:00 PM ET", 'The "Warriors" must end after 8:00 PM ET', "finish ... after 8:00"]) {
    assert.equal(quoteIsSubstring(quote, rules), false, quote);
  }
  const verdict = { decision: "NOT_SUPPORTED_NOW", reason: "PREMATURE", decisive_time_utc: "2023-04-29T00:00:00Z",
    checks: { timing: { status: "FAIL", clause_quote: '"Warriors" must finish after 8:00 PM ET', explanation: "The scheduled cutoff is later than the proposal." } } };
  assert.ok(validateVerdict(verdict, rules).verdict);
});

test.todo("KNOWN GAP (selector misses date-only crypto instants such as \"Bitcoin above 100000 on December 8?\"); fixed-time screen admits candles, instants, scheduled sports and explicit windows", () => {
  const examples = [
    ["Ethereum above $3,400 on June 21?", "Resolve using the Binance 1-minute candle for Ethereum at 12:00 ET on June 21, 2026.", "crypto_candle"],
    ["Ethereum Up or Down - December 18, 3PM ET", "q: title: Ethereum Up or Down - December 18, 3PM ET, description: Compare Ethereum prices at the start and end of the hourly period in the title.", "crypto_candle"],
    ["Bitcoin daily candle on December 8?", "Use the Bitcoin daily candle for December 8, 2026, in UTC.", "crypto_candle"],
    ["Bitcoin above 100000 on December 8?", "Use the Bitcoin price at 2026-12-08T12:00:00Z.", "crypto_instant"],
    ["NBA: Warriors vs Kings", "The NBA game is scheduled for April 28, 2023 at 8:00 PM EDT. Use the full game result.", "sports_scheduled"],
    ["Will a word be said this week?", "Count statements between December 8, 2026 at 12:00 AM ET and December 14, 2026 at 11:59 PM ET.", "observation_window"],
  ] as const;
  for (const [title, rules, kind] of examples) {
    const first = selectFixedTime(title, rules, NO);
    assert.equal(first.match?.kind, kind, title);
    assert.deepEqual(selectFixedTime(title, rules, NO), first, "regex state must not change on reruns");
    assert.equal(first.exclusion, null);
  }
});

test("selector rejects by/before-date YES and unrelated/date-only markets", () => {
  assert.equal(selectFixedTime("Will it happen by December 31?", "This market resolves Yes if it happens by December 31 at 11:59 PM ET.", YES).exclusion, "yes_by_before_deadline");
  assert.equal(selectFixedTime("Will the policy pass?", "This market resolves to Yes if the policy passes before November 30, 2026 at 11:59 PM ET.", YES).exclusion, "yes_by_before_deadline");
  for (const [title, rules] of [
    ["RFK Jr. endorses Trump before November?", "Resolve when an endorsement happens."],
    ["NBA: Warriors vs Kings", "The game is scheduled for April 28, 2023."],
    ["NBA: Warriors vs Kings", "The game is scheduled for April 28, 2023 at 8:00 PM."],
    ["Will the president resign?", "The press conference is at 12:00 PM ET on December 8. Resolve if the president resigns."],
    ["Will a policy pass by December 31?", "The deadline is December 31, 2026 at 11:59 PM ET."],
  ]) assert.equal(selectFixedTime(title!, rules!, NO).exclusion, "not_fixed_time", title);
});

function inputs(suffix = ""): ModelInputs {
  return { title: `Bitcoin fixed observation ${suffix}`, rules_text: "Use the Bitcoin price at 12:00 PM UTC on December 8, 2026.",
    proposal_time_utc: "2026-12-08T11:00:00Z", proposed_value: "0",
    gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: {}, events: [] } };
}

test("both providers always cap tokens, retain strict schema and share prompts", () => {
  for (const arm of ["raw", "serv"] as const) for (const format of ["json_schema", "plain"] as const) {
    const body = requestBody(arm, inputs(), format);
    assert.equal(body.max_tokens, 8000);
    assert.equal(body.model, MODELS[arm]);
    assert.equal("temperature" in body, false);
    if (format === "json_schema") assert.deepEqual(body.response_format, {
      type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA },
    });
    else assert.equal("response_format" in body, false);
  }
  assert.deepEqual(requestBody("raw", inputs(), "json_schema").messages, requestBody("serv", inputs(), "json_schema").messages);
  assert.deepEqual(VERDICT_SCHEMA.properties.reason.enum, ["PREMATURE", null]);
  assert.equal(CALL_INTERVAL_MS.raw, 1500);
  assert.equal(CALL_INTERVAL_MS.serv, 2000);
  assert.deepEqual(pilotArms("serv"), ["serv"]);
  assert.deepEqual(pilotArms(" serv, raw,serv "), ["raw", "serv"]);
  assert.throws(() => pilotArms(""));
  assert.throws(() => pilotArms("unknown"));
});

test("provider cost and reasoning tokens preserve zero versus missing values", () => {
  assert.deepEqual(responseUsage(JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24,
    completion_tokens_details: { reasoning_tokens: 5 }, cost: 0.0004 } })), {
    prompt: 11, completion: 13, total: 24, reasoning: 5, cost_usd: 0.0004,
  });
  assert.equal(responseUsage('{"usage":{"cost":"0","reasoning_tokens":0}}').cost_usd, 0);
  assert.equal(responseUsage('{"usage":{"cost":"0","reasoning_tokens":0}}').reasoning, 0);
  assert.equal(responseUsage('{}').cost_usd, null);
  assert.equal(responseUsage('{}').reasoning, null);
});

function packet(id: string): CasePacket {
  const modelInputs = inputs(id);
  return { schema_version: "timing-packet-1", case_id: `timing-${id.repeat(24)}`, packet_hash: inputHash(modelInputs),
    event_group: id, category: "crypto_fixed_time", model_inputs: modelInputs,
    fixed_time: { kind: "crypto_instant", matched_text: modelInputs.rules_text },
    provenance: { deployment: "fixture", request_id: id, proposal_hash: null, proposal_log_index: null,
      identity_verified_against_receipts: false, historical_rule_updates_verified: false } };
}

test("402 and 429 stop either entire arm after exactly one physical response", async () => {
  for (const arm of ["raw", "serv"] as const) for (const status of [402, 429]) {
    let calls = 0;
    let saved = 0;
    const attempt: ApiAttempt = { started_at: "2026-11-12T00:00:00Z", request_format: "json_schema", http_status: status,
      latency_ms: 1, response_text: '{"error":"balance or rate"}', network_error: null, usage: responseUsage('{}') };
    const client: CompletionClient = { async complete(_inputs, save) {
      calls += 1; await save(attempt, 1); return { attempts: [attempt], final: attempt };
    } };
    const records: Trial[] = [];
    const result = await runArm(arm, client, [packet("a"), packet("b")], async () => { saved += 1; }, async (record) => { records.push(record); });
    assert.equal(calls, 1);
    assert.equal(saved, 1);
    assert.equal(records.length, 6);
    assert.equal(records.filter((record) => record.status === "not_run").length, 5);
    assert.match(result.stop_reason!, new RegExp(`first HTTP ${status}`));
  }
});

test("report sums cost/reasoning without inventing missing SERV cost", () => {
  const p = packet("a");
  const label: CaseLabel = { case_id: p.case_id, packet_hash: p.packet_hash, label: "PREMATURE",
    expected_decision: "NOT_SUPPORTED_NOW", expected_reason: "PREMATURE", outcome_flipped: false,
    settlement_price: "unused", source: "ORACLE_SETTLEMENT_TIMING_PROXY", receipt_verified: false };
  const base = { started_at: "2026-11-12T00:00:00Z", request_format: "json_schema" as const,
    http_status: 200, latency_ms: 1, network_error: null };
  const trial: Trial = { arm: "raw", case_id: p.case_id, packet_hash: p.packet_hash, repetition: 1,
    status: "invalid", verdict: null, claimed_decision: null, errors: ["fixture"], attempts: [
      { ...base, usage: { prompt: 1, completion: 10, total: 11, reasoning: 4, cost_usd: 0.0001 } },
      { ...base, usage: { prompt: 1, completion: 10, total: 11, reasoning: 6, cost_usd: null } },
    ] };
  const report = pilotReport({ packets: [p], labels: new Map([[p.case_id, label]]), packetFileHash: "fixture", labelFileHash: "fixture" },
    [trial], { run: "fixture", status: "finished", arms: ["raw"], stops: { raw: null, serv: "Not selected" } });
  assert.ok(report.includes("Reasoning tokens | Total cost (USD)"));
  assert.ok(report.includes("0.00010000 (partial: 1/2 attempts)"));
  assert.ok(report.includes("| 10 |"));
  assert.ok(report.includes("unreported"));
});

test("B2 archive is preserved on rebuilds, checks hashes and never overwrites old labels", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "challengelens-b3-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const originals = new Map([
    ["dev/packets.jsonl", "old dev packets\n"], ["dev/labels.jsonl", "old dev labels\n"], ["dev/review.md", "old review\n"],
    ["sealed/packets.jsonl", "old sealed packets\n"], ["sealed/labels.jsonl", "old sealed labels\n"],
    ["manifests/split.json", '{"schema_version":"timing-split-1"}\n'],
  ]);
  for (const [path, text] of originals) {
    await mkdir(dirname(join(project, "data", path)), { recursive: true });
    await writeFile(join(project, "data", path), text, "utf8");
  }
  await archiveB2(project);
  await writeFile(join(project, "data/manifests/split.json"), '{"schema_version":"timing-split-2"}\n');
  await writeFile(join(project, "data/sealed/labels.jsonl"), "new labels\n");
  await archiveB2(project);
  for (const [path, text] of originals) assert.equal(await readFile(join(project, "data/archive/b2", path), "utf8"), text);
  await writeFile(join(project, "data/archive/b2/sealed/labels.jsonl"), "tampered\n");
  await assert.rejects(archiveB2(project), /hash mismatch/u);
});
