import assert from "node:assert/strict";
import { test } from "node:test";
import { clauseOffsets, linearScale, recomputeVerdict, snapMinute } from "../src/demo/math.js";
import { rulesStart, sportsEstimate } from "../src/demo/schedule.js";
import type { ModelInputs } from "../src/packets/types.js";

test("timeline scale inverts pointer coordinates and snaps across UTC midnight", () => {
  const start = Date.parse("2025-09-16T17:05:00Z");
  const end = Date.parse("2025-09-17T04:45:00Z");
  const scale = linearScale([start, end], [62, 938]);
  const point = Date.parse("2025-09-16T21:20:22Z");
  assert.equal(scale.invert(scale.map(point)), point);
  assert.equal(snapMinute(Date.parse("2025-09-16T23:59:41Z")), Date.parse("2025-09-17T00:00:00Z"));
});

test("the cutoff is inclusive and early YES needs evidence rather than a premature verdict", () => {
  const cutoff = "2025-09-17T04:45:00Z";
  const time = Date.parse(cutoff);
  assert.equal(recomputeVerdict(cutoff, time - 60000, false), "NOT_SUPPORTED_NOW");
  assert.equal(recomputeVerdict(cutoff, time, false), "SUPPORTED_NOW");
  assert.equal(recomputeVerdict(cutoff, time - 60000, true), "INSUFFICIENT_EVIDENCE");
  assert.equal(recomputeVerdict(cutoff, time, true), "SUPPORTED_NOW");
  assert.equal(recomputeVerdict(null, time, false), "INSUFFICIENT_EVIDENCE");
});

test("clause offsets highlight the original text after typography and whitespace normalization", () => {
  const rules = '🕒 Rule: “Close”\n  price at １２:００ ET. Do not paraphrase.';
  const quote = '"Close" price at 12:00 ET.';
  const offsets = clauseOffsets(rules, quote);
  assert.ok(offsets);
  assert.equal(rules.slice(offsets.start, offsets.end), '“Close”\n  price at １２:００ ET.');
  assert.equal(clauseOffsets(rules, '"Close" value at 12:00 ET.'), null);
  assert.equal(clauseOffsets("A cafe\u0301 closes", "café" )?.start, 2);
  assert.equal(clauseOffsets(rules, ""), null);
});

test("the Braves rules clock preserves ET daylight saving and the later Gamma start", () => {
  const inputs: ModelInputs = {
    title: "Braves vs. Nationals",
    rules_text: "In the upcoming MLB game, scheduled for September 16 at 1:05PM ET:",
    proposal_time_utc: "2025-09-16T21:20:22.000Z",
    proposed_value: "0",
    gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: { gameStartTime: "2025-09-16T22:45:00Z" }, events: [] },
  };
  assert.equal(rulesStart(inputs), "2025-09-16T17:05:00.000Z");
  assert.equal(sportsEstimate(inputs, "2025-09-17T04:45:00Z"), "estimated: baseball +6h");
});
