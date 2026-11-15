import assert from "node:assert/strict";
import { test } from "node:test";
import { axisTicks, HOUR, readableExplanation, rescheduleCallout, timelineDomain } from "../web/src/timeline-utils.js";
import type { RescheduleFacts } from "../web/src/timeline-utils.js";

test("axis ticks stay within six unique minute-aligned values, with dates only at day changes", () => {
  const start = Date.parse("2025-09-16T16:05:22Z");
  const end = Date.parse("2025-09-17T05:45:00Z");
  for (const requested of [4, 5, 6, 20]) {
    const ticks = axisTicks(start, end, requested);
    assert.ok(ticks.length >= 4 && ticks.length <= 6);
    assert.equal(new Set(ticks.map((tick) => tick.time)).size, ticks.length);
    assert.equal(new Set(ticks.map((tick) => tick.label)).size, ticks.length);
    let previousDay = "";
    for (const tick of ticks) {
      assert.ok(tick.time >= start && tick.time <= end);
      assert.equal(tick.time % 60_000, 0);
      const day = new Date(tick.time).toISOString().slice(0, 10);
      assert.equal(tick.label.includes("/"), day !== previousDay);
      previousDay = day;
    }
  }
  const short = axisTicks(start, start + 120_000, 6);
  assert.equal(new Set(short.map((tick) => tick.time)).size, short.length);
  assert.deepEqual(axisTicks(NaN, end), []);
});

test("the fitted domain has an hour on either side of the observation story", () => {
  const rules = Date.parse("2025-09-16T17:05:00Z");
  const cutoff = Date.parse("2025-09-17T01:45:00Z");
  assert.deepEqual(timelineDomain([rules, null, cutoff]), [rules - HOUR, cutoff + HOUR]);
});

test("reschedule wording derives the clocks, counterfactual cutoff, and proposal gap from data", () => {
  const facts: RescheduleFacts = {
    rules_time_utc: "2025-09-16T17:05:00Z",
    gamma_time_utc: "2025-09-16T22:45:00Z",
    proposal_time_utc: "2025-09-16T21:20:22Z",
    decisive_time_utc: "2025-09-17T01:45:00Z",
    sports: true,
    rules_text: "In the upcoming MLB game",
  };
  const text = rescheduleCallout(facts);
  assert.ok(text);
  for (const phrase of ["first pitch at 1:05 PM ET", "~4:05 PM ET", "6:45 PM ET (+5h40m)", "1h25m before"]) assert.ok(text.includes(phrase), text);
  assert.equal(rescheduleCallout({ ...facts, gamma_time_utc: facts.rules_time_utc }), null);
  assert.equal(rescheduleCallout({ ...facts, rules_time_utc: null }), null);
  assert.ok(!rescheduleCallout({ ...facts, decisive_time_utc: null })!.includes("text-only check"));
  const other = rescheduleCallout({ ...facts, rules_text: "NBA game", gamma_time_utc: "2025-09-16T18:05:00Z", decisive_time_utc: "2025-09-16T22:05:00Z" });
  assert.ok(other?.includes("tip-off"));
  assert.ok(other?.includes("(+1h)"));
  assert.ok(other?.includes("after"));
});

test("ISO times become human-readable UTC text without mutating the source explanation", () => {
  const raw = "The proposal at 2025-09-16T21:20:22.000Z precedes 2025-09-17T01:45:00Z.";
  const display = readableExplanation(raw);
  assert.ok(display.includes("Sep 16, 21:20 UTC"));
  assert.ok(display.includes("Sep 17, 01:45 UTC"));
  assert.ok(raw.includes("2025-09-16T21:20:22.000Z"));
  assert.equal(readableExplanation("No timestamp available."), "No timestamp available.");
});
