import { scopeFromInputs, incompleteGame } from "./sports-scope.js";
import type { SportsScope } from "./sports-scope.js";
import { proceedNeeds, describeNeeds } from "./needs.js";
import type { NeedDetail } from "./needs.js";
import { parsePriceWindow } from "../evidence/price.js";
import { feedNegativeReason } from "../evidence/as-of.js";
import type { Evidence, EvidenceAsOf } from "../evidence/as-of.js";
import type { Verdict } from "../judge/schema.js";
import type { ModelInputs } from "../packets/types.js";
import { servDecisiveUtc } from "./serv-time.js";
import type { ServTime } from "./serv-time.js";
import { cutoff, isSports, sportsTiming } from "./cutoff.js";
import type { Cutoff, SportsTiming } from "./cutoff.js";

export const GATE_VERSION = "gate-v8";
export interface Gate {
  version: typeof GATE_VERSION;
  template: Cutoff["template"] | "sports" | null;
  code_cutoff_utc: string | null;
  serv_decisive_time_utc: string | null;
  /** Optional only on previously generated gate artifacts. */
  serv_time?: ServTime;
  serv_clock_corrected?: boolean;
  agreement: "AGREE" | "DISAGREE" | "CODE_ONLY" | "SERV_ONLY" | "NA";
  gate_reason: string;
  serv_self_inconsistent?: boolean;
  sports: SportsTiming | null;
  sports_scope?: SportsScope;
  notes: string[];
  evidence?: EvidenceAsOf | null;
}
export interface GateDecision {
  needs: string[];
  need_details?: NeedDetail[];
  action: "PROCEED" | "WAIT" | "NEED_EVIDENCE" | "HOLD_FOR_REVIEW";
  earliest_utc?: string;
  evidence?: Evidence | null;
  evidence_as_of_proposal?: EvidenceAsOf;
  final_decision: Verdict["decision"];
  final_reason: "PREMATURE" | "BLOCKED_DISAGREEMENT" | null;
  gate: Gate;
}
function time(value: string | null): number | null {
  const parsed = value === null ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
/** Pure and browser-safe: no IO, model calls, wall clock, or environment. */
export function decide(serv: Verdict, code: Cutoff | null, proposal: string, proposedSide: string,
  options: { sports?: SportsTiming | null; sportsScope?: SportsScope; proposedOutcome?: string; earlyYes?: boolean; evidence?: EvidenceAsOf | undefined; checksOnly?: boolean; priceWindowNo?: boolean } = {}): GateDecision {
  const servTime = options.checksOnly ? { utc: null, source: null, model_utc: null, mismatch_seconds: null } : servDecisiveUtc(serv);
  const corrected = servTime.mismatch_seconds !== null && servTime.mismatch_seconds > 120;
  const clockNotes = corrected ? ["SERV UTC clock corrected from its stated local date/time/timezone."] : [];
  const p = time(proposal); const s = time(servTime.utc); const c = time(code?.cutoff_utc ?? null);
  const agreement: Gate["agreement"] = s !== null && c !== null ? Math.abs(s - c) <= 120_000 ? "AGREE" : "DISAGREE" : c !== null ? "CODE_ONLY" : s !== null ? "SERV_ONLY" : "NA";
  const selfInconsistent = p !== null && s !== null && (serv.decision === "SUPPORTED_NOW" && p < s || serv.decision === "NOT_SUPPORTED_NOW" && p >= s);
  const gate: Gate = { version: GATE_VERSION, template: options.sports ? "sports" : code?.template ?? null, code_cutoff_utc: code?.cutoff_utc ?? null,
    serv_decisive_time_utc: servTime.utc, serv_time: servTime, serv_clock_corrected: corrected, agreement, gate_reason: "", serv_self_inconsistent: selfInconsistent, sports: options.sports ?? null, ...(options.sports ? { sports_scope: options.sportsScope ?? "UNKNOWN" } : {}), notes: [...(code?.notes ?? []), ...clockNotes], evidence: options.evidence ?? null };
  const earliest = [c, s].filter((v): v is number => v !== null && p !== null && v > p);
  const result = (decision: Verdict["decision"], reason: GateDecision["final_reason"], why: string): GateDecision => {
    const value: Omit<GateDecision, "needs"> = { final_decision: decision, final_reason: reason, action: decision === "SUPPORTED_NOW" ? "PROCEED" : reason === "PREMATURE" ? "WAIT" : "NEED_EVIDENCE",
    ...(reason === "PREMATURE" && !options.sports && !options.earlyYes && earliest.length ? { earliest_utc: new Date(Math.max(...earliest)).toISOString() } : {}),
    ...(options.evidence ? { evidence_as_of_proposal: options.evidence } : {}), gate: { ...gate, gate_reason: why } };
    const needs = proceedNeeds(value).map((need) => need === "NEED_GAME_FINAL" && options.sports
      ? incompleteGame(options.sportsScope ?? "UNKNOWN", options.proposedOutcome ?? (proposedSide === "0" ? "No" : "Yes")).need : need);
    return { ...value, needs, need_details: describeNeeds(needs, value.earliest_utc) };
  };
  if (p === null) return result("INSUFFICIENT_EVIDENCE", null, "invalid proposal time");
  const e = options.evidence;
  const sportEvidence = options.sports && e && "game_finished" in e ? e : null;
  const priceEvidence = options.earlyYes && proposedSide === "1000000000000000000" && e && "event_occurred" in e ? e : null;
  const incomplete = incompleteGame(options.sportsScope ?? "UNKNOWN", options.proposedOutcome ?? (proposedSide === "0" ? "No" : "Yes"));
  if (sportEvidence?.game_finished === false) return incomplete.premature
    ? result("NOT_SUPPORTED_NOW", "PREMATURE", feedNegativeReason(sportEvidence)) : result("INSUFFICIENT_EVIDENCE", null, incomplete.reason);
  if (priceEvidence?.event_occurred === false) return result("NOT_SUPPORTED_NOW", "PREMATURE", "event had not occurred at proposal time (price scan)");
  const evidenceTime = time(sportEvidence?.game_finished ? sportEvidence.finished_utc ?? null : priceEvidence?.event_occurred ? priceEvidence.first_observed_utc ?? null : null);
  if (evidenceTime !== null && evidenceTime <= p) {
    if (!options.checksOnly && serv.decision !== "SUPPORTED_NOW") return result("INSUFFICIENT_EVIDENCE", null, "SERV did not approve");
    // gate-v5: the evidence instant is the deterministic corroboration. SERV must approve and must not
    // place its own cutoff after the proposal; it need not restate the feed timestamp to the second.
    if (s === null || s <= p) return result("SUPPORTED_NOW", null, options.checksOnly ? "evidence proves the event" : s !== null && Math.abs(s - evidenceTime) <= 120_000 ? "SERV and evidence agree" : "SERV approved; evidence proves the event");
    return result("INSUFFICIENT_EVIDENCE", null, "SERV cutoff is after the proposal");
  }
  if (options.sports) {
    const sports = options.sports;
    const starts = [sports.rules_start_utc, sports.gamma_start_utc].map(time).filter((v): v is number => v !== null);
    gate.code_cutoff_utc = null; // Duration estimates are descriptive only.
    gate.agreement = "NA";
    gate.notes = [...(sports.duration_hours === null ? [] : [`Estimated ${sports.sport} duration: +${sports.duration_hours}h; completion unverified.`]), ...clockNotes];
    if (starts.length && starts.every((start) => p < start)) return result("NOT_SUPPORTED_NOW", "PREMATURE", "before sports start");
    if (starts.some((start) => p < start)) return result("INSUFFICIENT_EVIDENCE", null, "schedule sources conflict");
    if (!incomplete.premature) return result("INSUFFICIENT_EVIDENCE", null, incomplete.reason);
    return result("INSUFFICIENT_EVIDENCE", null, "needs proof the game finished");
  }
  const beforeCode = c !== null && p < c; const beforeServ = s !== null && p < s;
  if (proposedSide === "1000000000000000000" && options.earlyYes && (beforeCode || beforeServ || c === null && s === null)) {
    return result("INSUFFICIENT_EVIDENCE", null, "early YES needs event evidence");
  }
  if (c !== null && s !== null && agreement === "DISAGREE" && beforeCode !== beforeServ) {
    return result("NOT_SUPPORTED_NOW", "BLOCKED_DISAGREEMENT", "keys disagree");
  }
  if (beforeCode || beforeServ) return result("NOT_SUPPORTED_NOW", "PREMATURE", "before cutoff");
  if (options.checksOnly && c !== null) return result("SUPPORTED_NOW", null, "deterministic cutoff passed");
  if (c !== null && options.priceWindowNo && serv.decision === "SUPPORTED_NOW") return result("SUPPORTED_NOW", null, "SERV approved; observation window ended");
  if (c !== null && s !== null && agreement === "AGREE") return serv.decision === "SUPPORTED_NOW"
    ? result("SUPPORTED_NOW", null, "both cutoffs passed") : result("INSUFFICIENT_EVIDENCE", null, "SERV did not approve");
  if (agreement === "DISAGREE") return result("INSUFFICIENT_EVIDENCE", null, "keys disagree");
  if (!options.checksOnly && c === null && s === null && serv.decision === "NOT_SUPPORTED_NOW") return result("NOT_SUPPORTED_NOW", "PREMATURE", "SERV-only premature verdict");
  return result("INSUFFICIENT_EVIDENCE", null, c === null ? "no independent cutoff" : "no usable SERV cutoff");
}
export function earlyYes(inputs: ModelInputs): boolean {
  if (inputs.proposed_value !== "1000000000000000000") return false;
  return /\bbetween\b/iu.test(inputs.rules_text) || /\b(?:by|before|until|reach(?:es)?|hit(?:s)?|touch(?:es)?|mention(?:s)?|say(?:s)?)\b/iu.test(inputs.title);
}
export function evaluateGate(inputs: ModelInputs, verdict: Verdict, servProposalTime = inputs.proposal_time_utc, checksOnly = false): GateDecision {
  const scope = scopeFromInputs(inputs);
  const priceWindow = parsePriceWindow(inputs);
  const result = decide(verdict, cutoff(inputs), inputs.proposal_time_utc, inputs.proposed_value, { checksOnly, priceWindowNo: Boolean(priceWindow && inputs.proposed_value === "0"), sportsScope: scope.scope, proposedOutcome: scope.proposed_outcome_label, sports: isSports(inputs) ? sportsTiming(inputs) : null, earlyYes: earlyYes(inputs) || Boolean(priceWindow && inputs.proposed_value === "1000000000000000000"), evidence: inputs.evidence_as_of_proposal });
  const p = time(servProposalTime); const s = time(servDecisiveUtc(verdict).utc);
  result.gate.serv_self_inconsistent = p !== null && s !== null && (verdict.decision === "SUPPORTED_NOW" && p < s || verdict.decision === "NOT_SUPPORTED_NOW" && p >= s);
  return result;
}

/** Zero inference: no model clock, approval, or verdict can influence this arm. */
export function evaluateChecksOnly(inputs: ModelInputs): GateDecision {
  const neutral: Verdict = { decision: "INSUFFICIENT_EVIDENCE", reason: null, decisive_time_utc: null,
    checks: { timing: { status: "UNKNOWN", clause_quote: "", explanation: "" } } };
  return evaluateGate(inputs, neutral, inputs.proposal_time_utc, true);
}
