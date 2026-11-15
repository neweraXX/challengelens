import test from "node:test";
import assert from "node:assert/strict";
import { sportsScope, proposedOutcomeLabel, thresholdSide } from "../src/gate/sports-scope.js";
import type { SportsScope } from "../src/gate/sports-scope.js";
import { evaluateGate } from "../src/gate/decide.js";
import { screenProposal, proposalPacket } from "../src/live/desk.js";
import type { Proposal } from "../src/live/desk.js";
import { decodeAncillary } from "../src/collect/ancillary.js";
import { gatedTrials } from "../src/gate/eval.js";
import type { ModelInputs } from "../src/packets/types.js";
import type { Verdict } from "../src/judge/schema.js";
import type { OracleRequest } from "../src/collect/types.js";

const rules = "This NBA football or tennis game is scheduled for November 14, 2026 at 1:00 PM ET.";
const rows: [string, string | undefined, string, SportsScope, boolean][] = [
  ["Florida State vs. Pittsburgh: 3Q Moneyline", "moneyline", "No", "PARTIAL_PERIOD", false],
  ["Florida State vs. Pittsburgh: 3Q O/U 13.5", "totals", "Under", "PARTIAL_PERIOD", false],
  ["Florida State vs. Pittsburgh: Both Teams to Score", undefined, "Yes", "FULL_GAME_THRESHOLD", false],
  ["Knicks vs. Pacers: O/U 204.5", "totals", "Over", "FULL_GAME_THRESHOLD", false],
  ["Knicks vs. Pacers: O/U 204.5", "totals", "Under", "FULL_GAME_THRESHOLD", true],
  ["Knicks vs. Pacers: Moneyline", "moneyline", "Yes", "FULL_GAME_RESULT", true],
  ["Magic full-game spread (-13.5)", "spreads", "Yes", "FULL_GAME_RESULT", true],
  ["Magic vs. Bucks: Both Teams to Score", undefined, "No", "FULL_GAME_THRESHOLD", true],
  ["Magic vs. Bucks: BTTS", "both_teams_to_score", "Yes", "FULL_GAME_THRESHOLD", false],
  ["1H Spread: Magic (-13.5)", "spreads", "No", "PARTIAL_PERIOD", false],
  ["2Q Spread: Magic (-3.5)", "spreads", "No", "PARTIAL_PERIOD", false],
  ["Games Total: O/U 2.5", "totals", "Under", "FULL_GAME_THRESHOLD", true],
  ["Tennis: Set 1 winner", "moneyline", "No", "PARTIAL_PERIOD", false],
  ["Player X threes: O/U 2.5", "threes", "Over", "FULL_GAME_THRESHOLD", false],
  ["Player X threes: O/U 2.5", "threes", "Under", "FULL_GAME_THRESHOLD", true],
  ["Player X special stat", "player_props", "Under", "FULL_GAME_THRESHOLD", true],
  ["Game 2 of the series winner", "moneyline", "No", "PARTIAL_PERIOD", false],
  ["First scorer", undefined, "No", "PARTIAL_PERIOD", false],
  ["Mystery special", undefined, "No", "UNKNOWN", false],
];
function inputs(title: string, label: string, type?: string): ModelInputs {
  return { title, rules_text: `${rules} res_data: p1: 0, p2: 1. Where p1 corresponds to ${label}, p2 to Yes, p3 to unknown/50-50.`, proposed_value: "0", proposal_time_utc: "2026-11-14T21:00:00Z",
    gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: { gameStartTime: "2026-11-14T18:00:00Z", ...(type ? { sportsMarketType: type } : {}) }, events: [] } };
}
const verdict: Verdict = { decision: "SUPPORTED_NOW", reason: null, decisive_time_utc: null, sports: null,
  decisive_local: { date: null, time: null, timezone: null, adjust_minutes: 0 }, checks: { timing: { status: "PASS", clause_quote: "game", explanation: "The game observation governs." } } };

test("sports scope covers the reported props, periods, winners, spreads and thresholds conservatively", () => {
  for (const [title, sportsMarketType, proposed_outcome_label, scope] of rows) assert.equal(sportsScope({ title, rules_text: rules, sportsMarketType, proposed_outcome_label }), scope, title);
  for (const title of ["Second half winner", "First-Half Spread", "4Q total", "Q1 winner", "First 10 minutes total", "Map 3 winner", "1st touchdown scorer", "First inning total", "Period 2 winner"]) {
    assert.equal(sportsScope({ title, rules_text: rules, proposed_outcome_label: "No" }), "PARTIAL_PERIOD", title);
  }
  assert.equal(sportsScope({ title: "Winner of coin toss", rules_text: rules, proposed_outcome_label: "No" }), "UNKNOWN");
});

test("saved pre-metadata runs recompute scope from their original title/rules and res_data", () => {
  for (const [title, label, expected] of [["Knicks vs. Pacers: O/U 204.5", "Over", "NEED_EVIDENCE"], ["Knicks vs. Pacers: O/U 204.5", "Under", "WAIT"], ["Florida State vs. Pittsburgh: 3Q Moneyline", "No", "NEED_EVIDENCE"]] as const) {
    const model_inputs = { ...inputs(title, label), evidence_as_of_proposal: { game_finished: false, source: "polymarket_gamma_event" as const } };
    const saved = { case_id: title, packet_hash: "hash", model_inputs };
    const rows = gatedTrials([saved], [{ case_id: saved.case_id, packet_hash: saved.packet_hash, arm: "serv", repetition: 1, status: "valid", verdict: { ...verdict, decision: "NOT_SUPPORTED_NOW", reason: "PREMATURE", checks: { timing: { ...verdict.checks.timing, status: "FAIL" } } } }]);
    assert.equal(rows[0]!.gated!.action, expected); assert.equal(rows[0]!.gated!.gate.version, "gate-v8");
  }
});

test("res_data determines Under/Over independently of numeric side or Gamma ordering", () => {
  const mapping = 'res_data: p1: 0, p2: 1. Where p1 corresponds to "Over 204.5", p2 to "Under 204.5", p3 to unknown/50-50.';
  assert.equal(proposedOutcomeLabel(mapping, "0"), "Over 204.5"); assert.equal(proposedOutcomeLabel(mapping, "1000000000000000000"), "Under 204.5");
  assert.equal(proposedOutcomeLabel("No mapping here", "0"), "No"); assert.equal(proposedOutcomeLabel("No mapping here", "1000000000000000000"), "Yes");
  assert.equal(thresholdSide("Over 204.5"), "REACHED"); assert.equal(thresholdSide("Under 204.5"), "NOT_REACHED"); assert.equal(thresholdSide("Yes or No"), "UNKNOWN");
});

test("gate-v6 and desk agree: unfinished full-game feeds cannot flag partial periods or reached sides", () => {
  for (const [title, type, label, scope, premature] of rows) {
    const base = inputs(title, label, type);
    const result = evaluateGate({ ...base, evidence_as_of_proposal: { game_finished: false, source: "polymarket_gamma_event" } }, verdict);
    assert.equal(result.gate.version, "gate-v8"); assert.equal(result.gate.sports_scope, scope);
    assert.equal(result.action, premature ? "WAIT" : "NEED_EVIDENCE", `${title} ${label}`);
    assert.ok(result.needs.includes(premature ? "NEED_GAME_FINAL" : scope === "FULL_GAME_THRESHOLD" ? "NEED_EVENT_OCCURRED" : "NEED_PERIOD_FINAL"));
    const p: Proposal = { proposal_id: title, deployment: "fixture", raw: { proposedPrice: "0" } as OracleRequest, ancillary: decodeAncillary(`0x${Buffer.from(base.rules_text).toString("hex")}`), title,
      rules_text: base.rules_text, market_id: null, proposal_time_utc: base.proposal_time_utc, liveness_ends_utc: "2026-11-15T00:00:00Z" };
    const packet = proposalPacket(p, null, base.proposal_time_utc);
    packet.model_inputs = base;
    const screen = screenProposal(packet, { kind: "sports_feed", source: "polymarket_gamma_event", event_id: "game", slug: "game", ended: false, finished_utc: null, score: "2-1", period: "3Q", fetched_at: new Date(Date.parse(base.proposal_time_utc) + 31 * 60_000).toISOString() });
    assert.equal(screen.sports_scope, scope); assert.equal(screen.proposed_outcome, label);
    assert.equal(screen.screen, premature ? "TOO_EARLY_BY_CODE" : "NO_DETERMINISTIC_KEY", `${title} ${label}`);
  }
});

test("finished feeds corroborate every scope, while SERV approval and cutoff consistency remain required", () => {
  for (const [title, type, label] of rows) {
    const base = { ...inputs(title, label, type), evidence_as_of_proposal: { game_finished: true, finished_utc: "2026-11-14T20:59:57Z", source: "polymarket_gamma_event" as const } };
    assert.equal(evaluateGate(base, verdict).action, "PROCEED", title);
    assert.equal(evaluateGate(base, { ...verdict, decision: "INSUFFICIENT_EVIDENCE", checks: { timing: { ...verdict.checks.timing, status: "UNKNOWN" } } }).action, "NEED_EVIDENCE");
    assert.equal(evaluateGate(base, { ...verdict, decisive_time_utc: "2026-11-14T21:01:00Z" }).action, "NEED_EVIDENCE");
  }
});

test("sports estimates never decide timing and before-start checks remain in place without a final feed", () => {
  for (const [title, type, label, , premature] of rows) {
    const base = inputs(title, label, type);
    assert.equal(evaluateGate(base, verdict).action, "NEED_EVIDENCE", title);
    assert.equal(evaluateGate({ ...base, proposal_time_utc: "2026-11-14T17:00:00Z" }, verdict).gate.gate_reason, "before sports start");
  }
});
