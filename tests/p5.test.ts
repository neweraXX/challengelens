import assert from "node:assert/strict";
import test from "node:test";
import type { SealedEvidence } from "../src/demo/types.js";
import { guardrailCounts, guardrailFrame, guardrailSchedule } from "../web/src/guardrail-utils.js";

function run(date: string, blind = true, total = 28, count = 19, checked = 0): SealedEvidence {
  return { date, blind, arms: [
    { arm: "serv", false_approvals: { count, total, low: 0, high: .82 } },
    { arm: "serv+gate", false_approvals: { count: checked, total, low: 0, high: .12064330476584563 } },
  ] } as SealedEvidence;
}
const current = { total: 28, aloneApproved: 19, checkedApproved: 0, intervalHigh: .12064330476584563 };

test("guardrail counts select the newest blind date, independent of ordering and second looks", () => {
  const old = run("2026-11-13T14:00:00Z", true, 15, 9);
  const newest = run("2026-11-14T06:22:54Z"); const laterSecondLook = run("2026-11-15T00:00:00Z", false, 30, 20);
  const source = [newest, laterSecondLook, old]; const before = JSON.stringify(source);
  assert.deepEqual(guardrailCounts(source), current);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(guardrailCounts([old, newest]), current);
  assert.equal(guardrailCounts([laterSecondLook]), null);
  assert.equal(guardrailCounts([]), null);
  assert.equal(guardrailCounts([run("invalid")]), null);
});

test("missing or incomparable arms hide the strip instead of borrowing an older run", () => {
  const missing = run("2026-11-14T00:00:00Z"); missing.arms.pop();
  assert.equal(guardrailCounts([run("2026-11-13T00:00:00Z"), missing]), null);
  const mismatch = run("2026-11-14T00:00:00Z"); mismatch.arms[1]!.false_approvals.total = 27;
  assert.equal(guardrailCounts([mismatch]), null);
  for (const invalid of [-1, 29, 1.5, NaN]) {
    const invalidCount = run("2026-11-14T00:00:00Z", true, 28, invalid);
    assert.equal(guardrailCounts([invalidCount]), null);
  }
  const noInterval = run("2026-11-14T00:00:00Z"); noInterval.arms[1]!.false_approvals.high = null;
  assert.equal(guardrailCounts([noInterval]), null);
  assert.equal(guardrailCounts([run("2026-11-14T00:00:00Z", true, 0, 0)]), null);
});

test("schedule staggers the current tiles by 60 ms and completes within four seconds", () => {
  const schedule = guardrailSchedule(28);
  assert.equal(schedule.staggerMs, 60);
  assert.equal(27 * schedule.staggerMs, 1620);
  assert.ok(schedule.entryEnd < schedule.stampEnd && schedule.stampEnd < schedule.checkStart);
  assert.equal(schedule.duration, 3760);
  assert.ok(schedule.duration >= schedule.checkEnd + 160); // Last held stamp can finish before the clock stops.
  for (const total of [0, 1, 28, 50, 200]) {
    assert.ok(guardrailSchedule(total).duration <= 4000);
    assert.ok(guardrailSchedule(total).staggerMs > 0);
  }
});

test("counter follows both phases, jumps to the exact endpoints, and never invents zero", () => {
  const schedule = guardrailSchedule(current.total);
  assert.equal(guardrailFrame(current, -10).approved, 0);
  assert.equal(guardrailFrame(current, NaN).approved, 0);
  assert.equal(guardrailFrame(current, schedule.entryEnd).approved, 0);
  assert.equal(guardrailFrame(current, schedule.stampEnd).approved, 19);
  assert.equal(guardrailFrame(current, schedule.stampEnd).checking, false);
  assert.equal(guardrailFrame(current, schedule.checkStart).approved, 19);
  assert.equal(guardrailFrame(current, schedule.checkStart).checking, true);
  assert.deepEqual(guardrailFrame(current, schedule.duration), { approved: 0, checking: true, gateProgress: 1, done: true });
  const partial = { ...current, checkedApproved: 3 };
  assert.equal(guardrailFrame(partial, schedule.duration + 500).approved, 3);
  const up = Array.from({ length: 20 }, (_, i) => guardrailFrame(current, schedule.entryEnd + i / 19 * 700).approved);
  const down = Array.from({ length: 20 }, (_, i) => guardrailFrame(current, schedule.checkStart + i / 19 * 850).approved);
  assert.ok(up.every((value, i) => value >= (up[i - 1] ?? 0)));
  assert.ok(down.every((value, i) => value <= (down[i - 1] ?? 19)));
});
