import assert from "node:assert/strict";
import test from "node:test";
import type { ShowcaseCase } from "../src/demo/types.js";
import { explainerData, gapText, humanGateReason } from "../web/src/live-utils.js";

test("timing reasons use plain words without changing source strings", () => {
  const examples = [
    ["feed marked the game final 375.88 min after the proposal (negative inference)", "The game was marked final 6 h 16 min after this proposal"],
    ["feed snapshot more than 30 min after the proposal still showed an in-play period (negative inference)", "The game was still in play 30+ min after this proposal"],
    ["game finished at proposal time (sports feed)", "The game had already finished when this was proposed"],
    ["needs proof the game finished", "No record that the game finished"],
    ["before cutoff", "Proposed before the market's cutoff"],
    ["both cutoffs passed", "Both clocks had passed"],
    ["SERV approved; evidence proves the event", "SERV agreed and the evidence confirms it"],
    ["early YES needs event evidence", "A YES this early needs proof the event happened"],
    ["before sports start", "Proposed before the game started"],
    ["keys disagree", "The checks disagree"],
    ["an unfamiliar reason", "An unfamiliar reason"],
    ["", ""],
  ];
  for (const [reason, expected] of examples) assert.equal(humanGateReason(reason!), expected);
  assert.equal(gapText(375.88 * 60), "6 h 16 min");
  assert.equal(humanGateReason("before cutoff."), "Proposed before the market's cutoff");
});

function fixture(): ShowcaseCase {
  // Only the fields consumed by the display selector; no real records are read.
  return {
    title: "Example game", category: "sports_in_game", proposal_time_utc: "2025-09-16T21:20:22Z",
    action: "NEED_EVIDENCE", rules_time_utc: "2025-09-16T17:05:00Z", gamma_time_utc: "2025-09-16T22:45:00Z",
    verdict: { checks: { timing: { clause_quote: "Fallback quote" } } },
    gate: { template: "sports", code_cutoff_utc: null, sports: { start_utc: "2025-09-16T22:45:00Z" } },
    evidence: { kind: "sports_feed", finished_utc: "2025-09-17T03:36:14.500Z", score: "5-0" },
    receipt: { action: "WAIT", gate: { template: "sports", code_cutoff_utc: null, serv_time: { utc: "2025-09-16T17:05:00Z" },
      sports: { start_utc: "2025-09-16T22:45:00Z", estimated_end_utc: "2025-09-17T04:45:00Z" }, gate_reason: "before sports start" },
    serv_verdict: { checks: { timing: { clause_quote: "  scheduled for September 16 at 1:05PM ET  " } }, decisive_local: { time: "13:05", timezone: "ET" } } },
  } as ShowcaseCase;
}

test("explainer selects saved receipt facts, computed clocks and the actual action", () => {
  const item = fixture(); const before = JSON.stringify(item); const data = explainerData(item);
  assert.equal(data.title, item.title);
  assert.equal(data.quote, "scheduled for September 16 at 1:05PM ET");
  assert.equal(data.localClock, "1:05 PM ET"); assert.equal(data.utcReading, "17:05 UTC");
  assert.equal(data.codeLabel, "Updated game start"); assert.equal(data.codeClock, "22:45 UTC");
  assert.equal(data.fact, "Game final 03:36 UTC · score 5-0");
  assert.equal(data.proposalClock, "21:20 UTC"); assert.equal(data.action, "WAIT");
  assert.ok(data.proposalPosition! < data.codePosition! && data.codePosition! < data.eventPosition!);
  assert.equal(JSON.stringify(item), before);
  item.receipt!.gate.code_cutoff_utc = "2025-09-17T04:45:00Z";
  assert.equal(explainerData(item).codeClock, "22:45 UTC"); // Never present an estimated end as proof.
  const passed = fixture(); passed.receipt!.action = "PROCEED";
  passed.proposal_time_utc = "2025-09-17T04:00:00Z";
  assert.ok(explainerData(passed).proposalPosition! > explainerData(passed).eventPosition!);
  assert.equal(explainerData(passed).action, "PROCEED");
});

test("explainer falls back to item facts and never invents a clock, event or approval", () => {
  const item = fixture(); delete item.receipt;
  assert.equal(explainerData(item).quote, "Fallback quote");
  item.verdict.checks.timing.clause_quote = "a long governing clause ".repeat(5);
  let data = explainerData(item);
  assert.equal(data.quote.length, 60); assert.ok(data.quote.endsWith("…"));
  assert.equal(data.localClock, "Local clock unavailable"); assert.equal(data.utcReading, "Time unavailable");
  assert.equal(data.action, "NEED_EVIDENCE");
  const empty = explainerData();
  assert.equal(empty.title, "Featured replay unavailable"); assert.equal(empty.quote, "No governing clause recorded.");
  assert.equal(empty.fact, "Event evidence unavailable"); assert.equal(empty.codePosition, null);
  assert.equal(empty.eventPosition, null); assert.equal(empty.proposalPosition, null);
  assert.equal(empty.action, "NEED_EVIDENCE");
  item.proposal_time_utc = "invalid"; item.evidence = null; item.game_finished_utc = "invalid";
  data = explainerData(item); assert.equal(data.proposalPosition, null); assert.equal(data.eventPosition, null);
});

test("non-sports fallback uses a real code cutoff and first event observation", () => {
  const item = fixture(); delete item.receipt; item.category = "crypto_fixed_time";
  item.gate!.template = "crypto_candle" as NonNullable<ShowcaseCase["gate"]>["template"];
  item.gate!.code_cutoff_utc = "2025-09-16T22:00:00Z";
  item.evidence = null; item.first_touch_utc = "2025-09-16T21:00:00Z";
  const data = explainerData(item);
  assert.equal(data.codeLabel, "Code cutoff"); assert.equal(data.codeClock, "22:00 UTC");
  assert.equal(data.fact, "Event observed 21:00 UTC");
  assert.ok(data.eventPosition! < data.proposalPosition!);
});
