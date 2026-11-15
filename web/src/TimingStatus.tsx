import type { GateDecision } from "../../src/gate/decide";

export type TimingAction = GateDecision["action"];
export const actionIcon = (action: TimingAction) => action === "PROCEED" ? "✓" : action === "WAIT" ? "◷" : action === "HOLD_FOR_REVIEW" ? "Ⅱ" : "ⓘ";
export const actionLabel = (action: TimingAction) => action === "PROCEED" ? "Proceed" : action === "WAIT" ? "Wait" : action === "HOLD_FOR_REVIEW" ? "On hold" : "Needs evidence";
export function timingAnswer(action: TimingAction, earliest?: string | null) {
  if (action === "PROCEED") return "Timing is supported";
  if (action === "HOLD_FOR_REVIEW") return "On hold after independent review";
  if (action === "NEED_EVIDENCE") return "Can't confirm yet. Here's what's missing";
  return earliest ? `Too early. Wait until ${friendlyTime(earliest)}` : "Too early. Wait for the event to finish";
}
export function friendlyTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC` : value;
}
export function TimingPill({ action }: { action: TimingAction }) {
  return <span className="timing-pill" data-action={action}><span aria-hidden="true">{actionIcon(action)}</span>{actionLabel(action)}</span>;
}
