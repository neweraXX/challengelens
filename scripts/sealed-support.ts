import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gatedTrials, checksOnlyTrials, servChangesMarkdown } from "../src/gate/eval.js";
import type { SavedInput, SavedTrial } from "../src/gate/eval.js";
import type { CaseLabel } from "../src/packets/types.js";
import { armNames } from "../src/demo/evidence.js";
import type { IntervalCount, SealedEvidence } from "../src/demo/types.js";

import { wilson, actionMetrics, actionMarkdown } from "../src/gate/metrics.js";
export { wilson } from "../src/gate/metrics.js";

export function confirmSealed(confirm: string | undefined, sha: string): void {
  if (confirm !== sha) throw new Error(`Sealed evaluation requires SEALED_CONFIRM=${sha}`);
}

/** Atomic reservation is intentionally never removed, even after interruption. */
export async function reserveSealed(root: string, sha: string, split?: SealedSplit): Promise<string> {
  if (!/^[a-f0-9]{64}$/u.test(sha)) throw new Error("Invalid procedure fingerprint");
  if (split !== undefined) root = join(root, sealedSplit(split));
  await mkdir(root, { recursive: true });
  const directory = join(root, sha.slice(0, 12));
  try { await mkdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("One-shot guard: this procedure already has a sealed reservation or results"); throw error; }
  return directory;
}

type UsageTrial = SavedTrial & { attempts: { usage: { total: number | null; cost_usd?: number | null } }[] };
function majority(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].find(([, count]) => count >= 2)?.[0] ?? null;
}

export function sealedAggregates(inputs: SavedInput[], trials: UsageTrial[], labels: Map<string, CaseLabel>, selected: ("raw" | "serv")[]): SealedEvidence["arms"] {
  for (const input of inputs) if (labels.get(input.case_id)?.packet_hash !== input.packet_hash) throw new Error("Saved label/input mismatch");
  const unique = new Set<string>();
  for (const trial of trials) {
    const key = JSON.stringify([trial.arm, trial.case_id, trial.repetition]);
    if (!selected.includes(trial.arm as "raw" | "serv") || ![1, 2, 3].includes(trial.repetition) || unique.has(key)) throw new Error("Unexpected or duplicate sealed trial");
    unique.add(key);
  }
  const rows = [...gatedTrials(inputs, trials), ...checksOnlyTrials(inputs)];
  return [...selected, "checks-only" as const].flatMap((arm) => {
    const own = rows.filter((row) => row.arm === arm);
    const attempts = trials.filter((trial) => trial.arm === arm).flatMap((trial) => trial.attempts);
    const costAttempts = attempts.filter((attempt) => typeof attempt.usage.cost_usd === "number");
    const usage = { tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage.total ?? 0), 0),
      recorded_cost_usd: costAttempts.reduce((sum, attempt) => sum + attempt.usage.cost_usd!, 0),
      cost_complete: arm === "checks-only" || attempts.length > 0 && costAttempts.length === attempts.length, cost_attempts: costAttempts.length, attempts: attempts.length };
    return (arm === "checks-only" ? [true] : [false, true]).map((gated) => {
      let correct = 0; let danger = 0; let abstained = 0; let consistent = 0; let completed = 0; let premature = 0;
      for (const input of inputs) {
        const group = own.filter((row) => row.case_id === input.case_id);
        const values = group.flatMap((row) => {
          if (row.status !== "valid" || !row.verdict) return [];
          return [gated ? { decision: row.gated!.final_decision, reason: row.gated!.final_reason } : { decision: row.verdict.decision, reason: row.verdict.reason }];
        });
        const decision = majority(values.map((value) => value.decision));
        const pair = majority(values.map((value) => JSON.stringify([value.decision, value.reason])));
        const label = labels.get(input.case_id)!;
        if (decision) {
          completed++;
          if (label.label === "PREMATURE") { premature++; if (decision === "SUPPORTED_NOW") danger++; }
          if (decision === "INSUFFICIENT_EVIDENCE") abstained++;
          if (pair === JSON.stringify([label.expected_decision, label.expected_reason])) correct++;
        }
        if (group.length === 3 && values.length === 3 && new Set(values.map((value) => JSON.stringify(value))).size === 1) consistent++;
      }
      const actions = actionMetrics(inputs, own.map((r) => ({ case_id: r.case_id, action: gated ? r.gated?.action ?? null : r.status === "valid" && r.verdict ? r.verdict.decision === "SUPPORTED_NOW" ? "PROCEED" : r.verdict.reason === "PREMATURE" ? "WAIT" : "NEED_EVIDENCE" : null })), labels);
      return { action_metrics: actions, arm: arm === "checks-only" ? "checks-only" as const : gated ? `${arm}+gate` as "raw+gate" | "serv+gate" : arm, correct: wilson(correct, completed), false_approvals: wilson(danger, premature),
        abstentions: wilson(abstained, completed), consistency: wilson(consistent, inputs.length), completed_cases: completed, cases: inputs.length, ...usage };
    });
  });
}

export function sealedMarkdown(data: SealedEvidence): string {
  const show = (metric: IntervalCount) => `${metric.count}/${metric.total} (${metric.low === null || metric.high === null ? "no interval" : `${(metric.low * 100).toFixed(2)}–${(metric.high * 100).toFixed(2)}%`})`;
  return ["# Sealed evaluation", "", `Procedure: ${data.procedure_version} / ${data.procedure_sha256}; gate: ${data.gate_version}; status: ${data.status}.`, "",
    `Blind: ${data.blind ?? "not recorded"}.${data.note ? ` ${data.note}` : ""}`, "",
    "Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.", "",
    "| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...data.arms.map((arm) => `| ${armNames[arm.arm]} | ${show(arm.correct)} | ${show(arm.false_approvals)} | ${show(arm.abstentions)} | ${show(arm.consistency)} | ${arm.completed_cases}/${arm.cases} | ${arm.tokens} | ${arm.recorded_cost_usd.toFixed(8)} | ${arm.cost_attempts}/${arm.attempts}${arm.cost_complete ? " complete" : " partial/unreported"} |`), "", "Action metrics (Wilson intervals use case majorities; precision ratio uses trials):", "",
    ...(data.serv_changes ? [servChangesMarkdown(data.serv_changes), ""] : []),
    ...data.arms.flatMap((arm) => arm.action_metrics ? [`${armNames[arm.arm]}`, "", "| Action metric | Result |", "| --- | --- |", actionMarkdown(arm.action_metrics), ""] : [])].join("\n");
}

export type SealedSplit = "sealed" | "sealed2";
export function sealedSplit(value: string | undefined = "sealed"): SealedSplit {
  if (value !== "sealed" && value !== "sealed2") throw new Error("Split must be sealed or sealed2");
  return value;
}
