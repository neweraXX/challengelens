import assert from "node:assert/strict";
import test from "node:test";
import type { Candidate } from "../src/collect/types.js";
import { buildEligible, eventGroups, privacyExclusion, settlementLabel, TOO_EARLY } from "../src/packets/build.js";
import { canonicalJson, inputHash } from "../src/packets/canonical.js";
import { selectSplits } from "../src/packets/split.js";
import { assertDevPath, assertModelInputs } from "../src/judge/dev-data.js";
import type { ApiAttempt, CompletionClient } from "../src/judge/client.js";
import { runArm } from "../src/judge/run-arm.js";
import type { Trial } from "../src/judge/run-arm.js";
import { firstJsonObject, validateVerdict } from "../src/judge/validate.js";

function candidate(index: number, group = String(Math.floor(index / 2))): Candidate {
  const titles = ["Alpha vs Beta match", "Bitcoin Up or Down at 5 PM UTC", "Will policy pass by December 31", "Will the president resign"];
  const title = `${titles[Math.floor(index / 2) % titles.length]} ${group}?`;
  const rules = `q: title: ${title}, description: This observation window is between December 1, 2026 at 12:00 AM UTC and December 31, 2026 at 23:59 UTC. Otherwise it resolves No.`;
  return {
    schemaVersion: "pilot-1", chainId: 137, deployment: "oov2",
    frozenBlock: { number: 1, hash: null, hasIndexingErrors: false },
    sampleKind: "disputed", requestCacheFile: "unused-test-cache",
    adapter: { address: "0x" + "1".repeat(40), label: "test fixture", verified: false },
    raw: {
      id: String(index), requester: "0x" + "1".repeat(40), identifier: "0x01", time: "1760000000",
      ancillaryData: `0x${Buffer.from(rules, "utf8").toString("hex")}`,
      state: "Settled", proposedPrice: "0", settlementPrice: index % 2 ? "0" : TOO_EARLY,
      proposalTimestamp: String(1760000000 + index), requestTimestamp: "1760000000",
      proposalHash: `0x${index.toString(16).padStart(64, "0")}`, proposalLogIndex: "0",
      proposer: null, disputer: "0x" + "2".repeat(40),
      requestBlockNumber: "1", requestHash: "0x" + "0".repeat(64), requestLogIndex: "0",
      proposalBlockNumber: "2", proposalExpirationTimestamp: "1760007200",
      disputeTimestamp: "1760000010", disputeHash: "0x" + "0".repeat(64),
      settlementTimestamp: "1760100000", settlementHash: "0x" + "0".repeat(64),
      currency: "0x" + "3".repeat(40), bond: "0", finalFee: "0", reward: "0", customLiveness: "0", eventBased: true,
    },
    ancillary: { decodedText: rules, utf8Valid: true, error: null, title, description: rules,
      resolutionRules: rules, extraction: "heuristic", questionIdHints: [], marketIdHints: [], hypothesizedQuestionId: null },
    gamma: { status: "joined", hashHypothesisJoined: true, attempts: [], markets: [{
      id: String(index), startDate: "2026-01-01T00:00:00Z", endDate: "2026-12-31T23:59:00Z",
      outcomePrices: "[0,1]", closed: true, closedTime: "2027-01-01", score: "99-0",
      events: [{ id: group, slug: `event-${group}`, startTime: "2026-12-31T00:00:00Z", winner: "DO NOT SEND" }],
    }] },
    settlementDiffersFromProposal: index % 2 === 0,
    identityVerifiedAgainstReceipts: false, controlDisputeAbsenceVerifiedAgainstLogs: false,
  };
}

test("oracle labels distinguish TOO_EARLY, binary equality/flip and excluded values", () => {
  assert.equal(settlementLabel("0", TOO_EARLY).label, "PREMATURE");
  assert.deepEqual(settlementLabel("0", "1000000000000000000"), { label: "TIMING_OK", flipped: true, exclusion: null });
  assert.equal(settlementLabel("0", "0").flipped, false);
  assert.equal(settlementLabel("0", "500000000000000000").exclusion, "settled_50_50");
  assert.equal(settlementLabel("500000000000000000", "500000000000000000").label, null);
  assert.equal(settlementLabel("0", "17").label, null);
});

test("model inputs contain no outcome fields or labels; labels do not affect their hash", () => {
  const row = candidate(0);
  const first = buildEligible([row]).eligible[0]!;
  const flipped = structuredClone(row);
  flipped.raw.settlementPrice = "1000000000000000000";
  const second = buildEligible([flipped]).eligible[0]!;
  assert.notEqual(first.label.label, second.label.label);
  assert.equal(first.packet.packet_hash, second.packet.packet_hash);
  assert.equal(first.packet.packet_hash, inputHash(first.packet.model_inputs));
  const text = canonicalJson(first.packet.model_inputs);
  for (const forbidden of ["outcomePrices", "closedTime", "winner", "score", "expected_decision", "settlement_price"]) {
    assert.equal(text.includes(forbidden), false);
  }
  assert.equal("settlement_price" in first.packet, false);
  assertModelInputs(first.packet.model_inputs);
  assert.throws(() => assertModelInputs({ ...first.packet.model_inputs, label: "PREMATURE" }));
  assert.throws(() => assertModelInputs({ ...first.packet.model_inputs, gamma_scheduling: {
    ...first.packet.model_inputs.gamma_scheduling, market: { outcomePrices: "[0,1]" },
  } }));
  assert.equal(inputHash({ b: 2, a: 1 }), inputHash({ a: 1, b: 2 }));
});

test("selection is deterministic, stratified and event-disjoint with a two-case cap", () => {
  const eligible = buildEligible(Array.from({ length: 64 }, (_, index) => candidate(index))).eligible;
  const chosen = selectSplits(eligible);
  assert.deepEqual(selectSplits([...eligible].reverse()), chosen);
  assert.equal(chosen.dev.length, 15);
  assert.equal(chosen.sealed.length, 30);
  assert.equal(chosen.dev.filter((item) => item.label.label === "PREMATURE").length, 8);
  assert.equal(chosen.sealed.filter((item) => item.label.label === "PREMATURE").length, 15);
  const devGroups = new Set(chosen.dev.map((item) => item.packet.event_group));
  assert.equal(chosen.sealed.some((item) => devGroups.has(item.packet.event_group)), false);
  const counts = new Map<string, number>();
  for (const item of [...chosen.dev, ...chosen.sealed]) counts.set(item.packet.event_group, (counts.get(item.packet.event_group) ?? 0) + 1);
  assert.equal([...counts.values()].every((count) => count <= 2), true);
  assert.throws(() => selectSplits(eligible.slice(0, 4)), /Cannot fill/u);
});

test("shared Gamma event aliases are one group; privacy screen excludes sensitive material", () => {
  const a = candidate(0, "one");
  const b = candidate(1, "two");
  a.gamma.markets[0]!.events = [{ id: "one", slug: "shared-event" }];
  b.gamma.markets[0]!.events = [{ id: "two", slug: "shared-event" }];
  const groups = eventGroups([a, b]);
  assert.equal(groups.get(a), groups.get(b));
  assert.equal(privacyExclusion("A market about sexual content"), "sexual_content");
  assert.equal(privacyExclusion("Is this person gay?"), "sensitive_personal_characteristics");
  assert.equal(privacyExclusion("Does this person have dementia?"), "sensitive_personal_characteristics");
  assert.equal(privacyExclusion("Will the bill pass by December?"), null);
  assert.throws(() => assertDevPath("data/sealed/packets.jsonl", "packets.jsonl"), /sealed/u);
});

const RULES = "This market resolves after December 31, 2026 at 23:59 UTC.";
function verdict(): Record<string, unknown> {
  return { decision: "NOT_SUPPORTED_NOW", reason: "PREMATURE", decisive_time_utc: "2026-12-31T23:59:00Z",
    checks: { timing: { status: "FAIL", clause_quote: RULES, explanation: "The required deadline has not passed." } } };
}

test("validator enforces exact quotes, closed fields, word cap, types and v1 semantics", () => {
  assert.ok(validateVerdict(verdict(), RULES).verdict);
  assert.equal(validateVerdict({ ...verdict(), extra: true }, RULES).verdict, null);
  assert.equal(validateVerdict({ ...verdict(), reason: "WRONG_SOURCE" }, RULES).verdict, null);
  assert.equal(validateVerdict({ ...verdict(), decisive_time_utc: "2026-02-30T00:00:00Z" }, RULES).verdict, null);
  assert.equal(validateVerdict({ ...verdict(), decision: "SUPPORTED_NOW" }, RULES).verdict, null);
  for (const timing of [
    { status: "FAIL", clause_quote: "After the deadline", explanation: "Not yet." },
    { status: "FAIL", clause_quote: RULES, explanation: Array(61).fill("word").join(" ") },
    { status: ["FAIL"], clause_quote: RULES, explanation: "Not yet." },
  ]) assert.equal(validateVerdict({ ...verdict(), checks: { timing } }, RULES).verdict, null);
  const withBraces = { ...verdict(), checks: { timing: { status: "FAIL", clause_quote: RULES, explanation: 'Literal braces { } and a "quote".' } } };
  assert.deepEqual(firstJsonObject(`preface\n\`\`\`json\n${JSON.stringify(withBraces)}\n\`\`\``), withBraces);
  assert.throws(() => firstJsonObject('{"decision":'));
});

test("first raw 429 stops the entire arm without another call, including later repetitions", async () => {
  let calls = 0;
  let saved = 0;
  const attempt: ApiAttempt = { started_at: "2026-11-11T00:00:00Z", request_format: "json_object", http_status: 429, latency_ms: 1,
    response_text: '{"error":"quota"}', network_error: null, usage: { prompt: null, completion: null, total: null } };
  const client: CompletionClient = { async complete(_inputs, save) {
    calls += 1;
    await save(attempt, 1);
    return { attempts: [attempt], final: attempt };
  } };
  const records: Trial[] = [];
  const packets = buildEligible([candidate(0), candidate(1)]).eligible.map((item) => item.packet);
  const outcome = await runArm("raw", client, packets, async () => { saved += 1; }, async (trial) => { records.push(trial); });
  assert.equal(calls, 1);
  assert.equal(saved, 1);
  assert.equal(records.length, 6);
  assert.equal(records.filter((record) => record.status === "error").length, 1);
  assert.equal(records.filter((record) => record.status === "not_run").length, 5);
  assert.match(outcome.stop_reason!, /first HTTP 429/u);
});
