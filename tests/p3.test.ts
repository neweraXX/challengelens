import assert from "node:assert/strict";
import test from "node:test";
import type { DeskItem, Snapshot } from "../src/live/desk.js";
import { breakdown, countdown, finalTiming, freshness, humanNeed, humanScope, humanScreen, screenOrder, teaserText } from "../web/src/live-utils.js";

test("desk screens, scopes and needs have human labels, including unknown values", () => {
  assert.deepEqual(screenOrder.map(humanScreen), ["Too early by code", "Inside feed lag", "Confirmed on time", "Passed code cutoff", "No deterministic key"]);
  assert.equal(humanScreen("FUTURE_SCREEN"), "Screen unavailable");
  assert.equal(humanScope("FULL_GAME_RESULT"), "Full-game result");
  assert.equal(humanScope("FULL_GAME_THRESHOLD"), "Line market: Over/Yes can settle before full time");
  assert.equal(humanScope("PARTIAL_PERIOD"), "Period market");
  assert.equal(humanScope("UNKNOWN"), "Scope not established");
  assert.equal(humanScope("FUTURE_SCOPE"), "Scope not established");
  for (const need of ["NEED_PERIOD_FINAL", "NEED_GAME_FINAL", "NEED_EVENT_OCCURRED", "NEED_CUTOFF_READING", "NEED_SERV_APPROVAL", "WAIT_UNTIL", "NEED_REVIEW_CLEARANCE", "FUTURE_NEED"]) {
    assert.ok(humanNeed(need).length > 15);
    assert.doesNotMatch(humanNeed(need), /NEED_|WAIT_UNTIL|FUTURE_/u);
  }
});

test("countdowns handle inclusive expiry, subsecond rounding, hours and invalid dates", () => {
  const now = Date.parse("2026-11-14T05:18:00Z");
  assert.equal(countdown("2026-11-14T05:18:00Z", now), "Window ended");
  assert.equal(countdown("2026-11-14T05:17:59Z", now), "Window ended");
  assert.equal(countdown("2026-11-14T05:18:00.001Z", now), "0m 01s");
  assert.equal(countdown("2026-11-14T05:18:59.001Z", now), "1m 00s");
  assert.equal(countdown("2026-11-14T06:20:03Z", now), "1h 02m 03s");
  assert.equal(countdown("invalid", now), "Time unavailable");
  assert.equal(countdown("2026-11-14T06:20:03Z", NaN), "Time unavailable");
});

type Row = Pick<DeskItem, "screen" | "sports_scope" | "needs">;
function missing(sports_scope: Row["sports_scope"], needs: string[]): Row { return { screen: "NO_DETERMINISTIC_KEY", sports_scope, needs }; }
test("missing-key breakdown partitions the verified 369-row gap without double counting", () => {
  const rows: Row[] = [
    ...Array.from({ length: 217 }, () => missing("FULL_GAME_THRESHOLD", ["NEED_EVENT_OCCURRED"])),
    ...Array.from({ length: 81 }, () => missing("PARTIAL_PERIOD", ["NEED_PERIOD_FINAL", "NEED_GAME_FINAL"])),
    ...Array.from({ length: 48 }, () => missing("UNKNOWN", ["NEED_PERIOD_FINAL"])),
    ...Array.from({ length: 23 }, () => missing("FULL_GAME_RESULT", ["NEED_GAME_FINAL"])),
    { screen: "ON_TIME_BY_FEED", sports_scope: "FULL_GAME_RESULT", needs: [] },
    { screen: "WITHIN_FEED_LAG", sports_scope: "FULL_GAME_RESULT", needs: ["NEED_GAME_FINAL"] },
  ];
  assert.deepEqual(breakdown(rows).map((group) => group.count), [81, 217, 23, 48]);
  assert.equal(breakdown(rows).reduce((sum, group) => sum + group.count, 0), 369);
  assert.deepEqual(breakdown([]).map((group) => group.count), [0, 0, 0, 0]);
  assert.deepEqual(breakdown([missing("FULL_GAME_THRESHOLD", ["NEED_GAME_FINAL"]), missing("UNKNOWN", [])]).map((group) => group.count), [0, 0, 1, 1]);
  assert.deepEqual(breakdown([missing("PARTIAL_PERIOD", ["NEED_CUTOFF_READING"])]).map((group) => group.count), [0, 0, 0, 1]);
});

test("home teaser never invents counts and labels stale snapshots as past data", () => {
  assert.equal(teaserText(null), "Live desk temporarily unavailable");
  assert.equal(teaserText({ totals: null, generated_at: null, stale: true }), "Live desk temporarily unavailable");
  const totals = { in_liveness: 380, bond_in_liveness_usdc: 163000, flagged: 0 } as Snapshot["totals"];
  const snapshot = { totals, generated_at: "2026-11-14T05:18:00Z", stale: false };
  assert.equal(teaserText(snapshot), "Right now: 380 proposals in the challenge window · 163,000 USDC in bonds · 0 flagged");
  assert.match(teaserText({ ...snapshot, stale: true }), /^Last snapshot:/u);
  assert.equal(teaserText({ ...snapshot, generated_at: null }), "Live desk temporarily unavailable");
  assert.equal(teaserText({ ...snapshot, totals: { ...totals, in_liveness: 0, bond_in_liveness_usdc: 0 } }), "Right now: 0 proposals in the challenge window · 0 USDC in bonds · 0 flagged");
});

test("final timing respects the sign and only identifies the feed-lag screen as lag", () => {
  assert.equal(finalTiming(-73, "WITHIN_FEED_LAG"), "Final marked 1 min 13 s later (feed lag)");
  assert.equal(finalTiming(-901, "TOO_EARLY_BY_CODE"), "Final marked 15 min 1 s later");
  assert.equal(finalTiming(0, "ON_TIME_BY_FEED"), "Proposed 0.0 s after final");
  assert.equal(finalTiming(42, "ON_TIME_BY_FEED"), "Proposed 42 s after final");
  assert.equal(finalTiming(null, "NO_DETERMINISTIC_KEY"), "Final time unavailable");
});

test("freshness advances API age locally and tolerates clock skew and missing snapshots", () => {
  const received = Date.parse("2026-11-14T05:18:00Z");
  assert.equal(freshness({ age_ms: 42000, generated_at: "2026-11-14T05:17:18Z" }, received, received), "Updated 42 s ago");
  assert.equal(freshness({ age_ms: 42000, generated_at: null }, received, received + 1000), "Updated 43 s ago");
  assert.equal(freshness({ age_ms: null, generated_at: "2026-11-14T05:17:18Z" }, received, received), "Updated 42 s ago");
  assert.equal(freshness({ age_ms: null, generated_at: null }, received, received), "No successful snapshot yet");
  assert.equal(freshness({ age_ms: -1000, generated_at: null }, received, received), "Updated 0 s ago");
});
