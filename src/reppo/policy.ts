import type { Verdict } from "../judge/schema.js";
import type { ReppoConfidence, ReppoDecision, ReppoRoute } from "./client.js";
export interface ReppoSummary {
  eval_id: string; score: number; route: ReppoRoute; decision: ReppoDecision; confidence: ReppoConfidence; reason: string; completed_at: string;
  evaluated_receipt_sha256: string;
}
export const HOLD_STATUS = "Hold: independent review disagrees";
/** Independent review can withhold PROCEED, never upgrade any action. */
export function reviewPolicy(decision: Verdict["decision"], review: (Pick<ReppoSummary, "route" | "decision"> & { score?: number }) | null | undefined,
  action: import("../gate/decide.js").GateDecision["action"] = decision === "SUPPORTED_NOW" ? "PROCEED" : decision === "NOT_SUPPORTED_NOW" ? "WAIT" : "NEED_EVIDENCE") {
  const held = action === "PROCEED" && Boolean(review && (review.route === "block" || review.decision === "reject" || review.route === "review" && (review.score ?? 0) < 70));
  return { final_decision: held ? "INSUFFICIENT_EVIDENCE" as const : decision,
    action: held ? "HOLD_FOR_REVIEW" as const : action, held: held || action === "HOLD_FOR_REVIEW",
    ...(held || action === "HOLD_FOR_REVIEW" ? { gate_reason: "held by independent review" } : {}),
    display_status: held || action === "HOLD_FOR_REVIEW" ? HOLD_STATUS : decision };
}
