import { actionMetrics } from "./metrics.js";
import type { ModelInputs, CaseLabel } from "../packets/types.js";
import type { Verdict } from "../judge/schema.js";
import { evaluateGate, evaluateChecksOnly, GATE_VERSION } from "./decide.js";

export interface SavedInput { case_id: string; packet_hash: string; model_inputs: ModelInputs }
export interface SavedTrial { arm: string; case_id: string; packet_hash: string; repetition: number; status: string; verdict: Verdict | null }
export function gatedTrials(inputs: SavedInput[], trials: SavedTrial[]) {
  const byId = new Map(inputs.map((input) => [input.case_id, input]));
  return trials.map((trial) => {
    const input = byId.get(trial.case_id);
    if (!input || input.packet_hash !== trial.packet_hash) throw new Error("Saved trial/input packet mismatch");
    return { ...trial, gated: trial.status === "valid" && trial.verdict ? evaluateGate(input.model_inputs, trial.verdict) : null };
  });
}
/** Reuses validated saved verdicts; performs zero inference calls. */
export function gatedMetrics(inputs: SavedInput[], trials: SavedTrial[], labels: Map<string, CaseLabel>, repetitions = 3) {
  const rows = [...gatedTrials(inputs, trials), ...checksOnlyTrials(inputs, repetitions)];
  for (const input of inputs) {
    if (labels.get(input.case_id)?.packet_hash !== input.packet_hash) throw new Error("Saved label/input packet mismatch");
  }
  return { gate_version: GATE_VERSION, rows, serv_changes: servChanges(inputs, trials), arms: ["raw", "serv", "checks-only"].map((arm) => {
    const own = rows.filter((row) => row.arm === arm);
    const isCorrect = (row: typeof rows[number]) => row.gated?.final_decision === labels.get(row.case_id)!.expected_decision &&
      row.gated.final_reason === labels.get(row.case_id)!.expected_reason;
    const accuracy = (label: string) => ({ correct: own.filter((row) => labels.get(row.case_id)!.label === label && isCorrect(row)).length,
      planned: inputs.filter((input) => labels.get(input.case_id)!.label === label).length * repetitions });
    const abstentions = own.filter((row) => row.gated?.final_decision === "INSUFFICIENT_EVIDENCE");
    const reasons: Record<string, number> = {};
    for (const row of abstentions) { const reason = row.gated!.gate.gate_reason; reasons[reason] = (reasons[reason] ?? 0) + 1; }
    return { arm: arm === "checks-only" ? arm : `${arm}+gate`, action_metrics: actionMetrics(inputs, own.map((r) => ({ case_id: r.case_id, action: r.gated?.action ?? null })), labels), planned: inputs.length * repetitions, correct: own.filter(isCorrect).length,
      premature: accuracy("PREMATURE"), timing_ok: accuracy("TIMING_OK"), valid: own.filter((row) => row.gated !== null).length,
      false_supported: own.filter((row) => labels.get(row.case_id)!.label === "PREMATURE" && row.gated?.final_decision === "SUPPORTED_NOW").length,
      invalid: own.filter((row) => row.status === "invalid").length, errors: own.filter((row) => row.status === "error").length,
      not_run: inputs.length * repetitions - own.filter((row) => row.status !== "not_run").length,
      abstained: abstentions.length, abstentions_by_gate_reason: reasons,
      consistent_cases: inputs.filter((input) => { const group = own.filter((row) => row.case_id === input.case_id);
        return group.length === repetitions && group.every((row) => row.gated) && new Set(group.map((row) => JSON.stringify([row.gated?.final_decision, row.gated?.final_reason]))).size === 1;
      }).length, cases: inputs.length,
    };
  }) };
}

/** Repetitions are duplicated only for the same reporting denominator; there are zero HTTP calls. */
export function checksOnlyTrials(inputs: SavedInput[], repetitions = 3) {
  return inputs.flatMap((input) => {
    const gated = evaluateChecksOnly(input.model_inputs);
    const verdict: Verdict = { decision: gated.final_decision, reason: gated.final_reason === "PREMATURE" ? "PREMATURE" : null,
      decisive_time_utc: null, checks: { timing: { status: gated.action === "PROCEED" ? "PASS" : gated.action === "WAIT" ? "FAIL" : "UNKNOWN", clause_quote: "", explanation: "Offline deterministic checks" } } };
    return Array.from({ length: repetitions }, (_, index) => ({ arm: "checks-only", case_id: input.case_id, packet_hash: input.packet_hash, repetition: index + 1, status: "valid", verdict, gated, attempts: [] }));
  });
}
export function servChanges(inputs: SavedInput[], trials: SavedTrial[]) {
  const rows = gatedTrials(inputs, trials).filter((r) => r.arm === "serv");
  const counts = { compared_cases: 0, serv_blocked_checks_proceed: 0, serv_enabled_without_checks: 0, other_disagreements: 0, missing_serv_majority: 0 };
  for (const input of inputs) {
    const own = rows.filter((r) => r.case_id === input.case_id);
    const actions = own.flatMap((r) => r.gated ? [r.gated.action] : []);
    const action = actions.find((a) => actions.filter((b) => b === a).length >= 2);
    if (!action) { counts.missing_serv_majority++; continue; }
    counts.compared_cases++;
    const checks = evaluateChecksOnly(input.model_inputs).action;
    if (checks === "PROCEED" && action !== "PROCEED") counts.serv_blocked_checks_proceed++;
    else if (checks !== "PROCEED" && action === "PROCEED") counts.serv_enabled_without_checks++;
    else if (checks !== action) counts.other_disagreements++;
  }
  return counts;
}
export function servChangesMarkdown(counts: ReturnType<typeof servChanges>): string {
  return `Cases where SERV changed the outcome vs checks-only (case-majority, aggregates only):\n\n| Direction | Cases |\n| --- | --- |\n| SERV blocked a checks-only PROCEED | ${counts.serv_blocked_checks_proceed} |\n| SERV enabled nothing by itself (unsupported enables) | ${counts.serv_enabled_without_checks} |\n| Other action disagreements | ${counts.other_disagreements} |\n| Missing SERV majority | ${counts.missing_serv_majority} |\n| Compared | ${counts.compared_cases} |\n`;
}
export function gateMetricsMarkdown(metrics: ReturnType<typeof gatedMetrics>): string {
  return `| Arm | Strict correct | False approvals | Abstentions | Consistent cases |\n| --- | --- | --- | --- | --- |\n` +
    metrics.arms.map((a) => `| ${a.arm} | ${a.correct}/${a.planned} | ${a.false_supported}/${a.premature.planned} | ${a.abstained}/${a.planned} | ${a.consistent_cases}/${a.cases} |`).join("\n") + "\n\n" + servChangesMarkdown(metrics.serv_changes);
}

export type ServChanges = ReturnType<typeof servChanges>;
