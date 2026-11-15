export type NeedCode = "NEED_PERIOD_FINAL" | "NEED_GAME_FINAL" | "NEED_EVENT_OCCURRED" | "NEED_CUTOFF_READING" | "NEED_SERV_APPROVAL" | "WAIT_UNTIL" | "NEED_REVIEW_CLEARANCE";
export interface NeedDetail { code: string; text: string; earliest_utc?: string }
interface Context {
  action: string; earliest_utc?: string;
  gate: { sports_scope?: string; template: string | null; gate_reason: string; code_cutoff_utc: string | null; evidence?: unknown };
}
export function proceedNeeds(value: Context): NeedCode[] {
  if (value.action === "PROCEED") return [];
  if (value.action === "HOLD_FOR_REVIEW") return ["NEED_REVIEW_CLEARANCE"];
  const reason = value.gate.gate_reason; const e = value.gate.evidence as { game_finished?: boolean; event_occurred?: boolean } | null | undefined;
  const needs: NeedCode[] = [];
  if (value.gate.template === "sports" && e?.game_finished !== true) {
    if (/line may already be crossed/iu.test(reason)) needs.push("NEED_EVENT_OCCURRED");
    else if (value.gate.sports_scope === "PARTIAL_PERIOD" || value.gate.sports_scope === "UNKNOWN" || /period this market/iu.test(reason)) needs.push("NEED_PERIOD_FINAL");
    else needs.push("NEED_GAME_FINAL");
  }
  if (/early YES|event had not occurred/iu.test(reason)) needs.push("NEED_EVENT_OCCURRED");
  if (value.action === "WAIT" && value.earliest_utc) needs.push("WAIT_UNTIL");
  if (/SERV did not approve|no usable SERV|SERV cutoff is after/iu.test(reason)) needs.push("NEED_SERV_APPROVAL");
  if (/keys disagree|no independent cutoff|invalid proposal|not supported/iu.test(reason) && !needs.length) needs.push("NEED_CUTOFF_READING");
  if (!needs.length) needs.push(value.action === "WAIT" ? "NEED_SERV_APPROVAL" : "NEED_CUTOFF_READING");
  return needs;
}
/** One vocabulary for API clients, receipts, the desk and showcase rendering. */
export function describeNeeds(needs: readonly string[], earliest_utc?: string): NeedDetail[] {
  const text: Record<NeedCode, string> = {
    NEED_PERIOD_FINAL: "Confirm the period this market covers has ended; the full-game feed cannot time this market",
    NEED_GAME_FINAL: "Confirm the game has finished: the sports feed has no completion record at proposal time",
    NEED_EVENT_OCCURRED: "Show the event already happened inside the window: an early YES or reached line needs event evidence; verify the live score",
    NEED_CUTOFF_READING: "No supported, agreed cutoff in the rules: read the governing clause manually",
    NEED_SERV_APPROVAL: "Obtain a SERV rule reading that approves the timing and agrees with the governing cutoff",
    WAIT_UNTIL: earliest_utc ? `Wait until ${earliest_utc}, then check again` : "Wait for the governing observation to finish, then check again",
    NEED_REVIEW_CLEARANCE: "Resolve the independent review hold before proceeding",
  };
  return needs.map((code) => ({ code, text: text[code as NeedCode] ?? "Read the governing clause manually", ...(code === "WAIT_UNTIL" && earliest_utc ? { earliest_utc } : {}) }));
}
