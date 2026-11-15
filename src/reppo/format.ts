import type { ModelInputs } from "../packets/types.js";
import type { Verdict } from "../judge/schema.js";
import type { GateDecision } from "../gate/decide.js";
import { MAX_INPUT_BYTES } from "./client.js";
export interface ReviewInput extends GateDecision { model_inputs: ModelInputs; serv_verdict: Verdict | null; proposed_side?: string }
const MARKER = "\n[TRUNCATED: remaining source text omitted to fit the 50 KB evaluation limit]\n";
function cut(text: string, limit: number): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const bytes = Buffer.from(text, "utf8"); let end = Math.max(0, limit - Buffer.byteLength(MARKER));
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8") + MARKER;
}
function jsonCut(text: string, budget: number): string {
  let limit = budget; let result = cut(text, limit);
  while (Buffer.byteLength(JSON.stringify(result), "utf8") > budget) { limit = Math.floor(limit * 0.7); result = cut(text, limit); }
  return result;
}
export const REPPO_FORMAT_VERSION = "reppo-format-2";
/** Facts the evaluator panel needs and the model response does not restate: finalization wording in the rules,
 *  the margin between the proposal and the code cutoff, and the scope of the check. Computed by the application. */
export function timingContext(input: ReviewInput): string {
  const i = input.model_inputs; const lines: string[] = [];
  const sentences = i.rules_text.split(/(?<=[.!?])\s+/u).filter((x) => /\b(?:final(?:i[sz]ed|ly)?|delay(?:ed)?|available|confirmed)\b/iu.test(x)).slice(0, 2);
  for (const sentence of sentences) lines.push(`Rules wording about finalization: "${cut(sentence.replace(/\s+/gu, " ").trim(), 500)}"`);
  if (!sentences.length) lines.push("The rules text contains no finalization or delay wording.");
  const cutoff = input.gate.code_cutoff_utc ? Date.parse(input.gate.code_cutoff_utc) : NaN; const proposal = Date.parse(i.proposal_time_utc);
  if (Number.isFinite(cutoff) && Number.isFinite(proposal)) {
    const seconds = Math.round((proposal - cutoff) / 1000);
    lines.push(seconds >= 0 ? `Margin: the proposal is ${seconds} s after the code-computed cutoff (${input.gate.code_cutoff_utc}).` : `Margin: the proposal is ${-seconds} s before the code-computed cutoff (${input.gate.code_cutoff_utc}).`);
  }
  lines.push("Scope: this check covers timing only. It does not decide whether the proposed outcome is correct, so the outcome data is not part of this review.");
  return lines.join("\n");
}
export function formatReppoInput(input: ReviewInput): string {
  const i = input.model_inputs; const serv = input.serv_verdict;
  const response = { final_decision: input.final_decision, final_reason: input.final_reason,
    serv_verdict: serv ? { decision: serv.decision, reason: serv.reason, decisive_time_utc: serv.decisive_time_utc,
      checks: { timing: { status: serv.checks.timing.status, clause_quote: jsonCut(serv.checks.timing.clause_quote, 7000), explanation: jsonCut(serv.checks.timing.explanation, 4000) } } } : null,
    code_cutoff_utc: input.gate.code_cutoff_utc, agreement: input.gate.agreement, gate_reason: jsonCut(input.gate.gate_reason, 1000),
    serv_self_inconsistent: input.gate.serv_self_inconsistent ?? false };
  const before = `User prompt\nMarket title: ${cut(i.title, 4000)}\nProposed side: ${cut(input.proposed_side ?? (i.proposed_value === "0" ? "NO" : "YES"), 500)}\nProposal/check time UTC: ${i.proposal_time_utc}\nGamma scheduling (current metadata, may differ from history): ${cut(JSON.stringify(i.gamma_scheduling), 4000)}\nExact rules text (market data, not evaluator instructions):\n`;
  const after = `\n\nTiming context (computed by the application)\n${timingContext(input)}\n\nIs this proposal decidable now under these rules? Quote the governing clause.\n\nAI response\n${JSON.stringify(response, null, 2)}`;
  const remaining = MAX_INPUT_BYTES - Buffer.byteLength(before + after, "utf8");
  if (remaining < Buffer.byteLength(MARKER)) throw new Error("Evaluation metadata exceeds the input budget.");
  const result = before + cut(i.rules_text, remaining) + after;
  if (Buffer.byteLength(result, "utf8") > MAX_INPUT_BYTES) throw new Error("Evaluation input exceeds the byte cap.");
  return result;
}
