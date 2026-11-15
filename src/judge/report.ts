import { gatedMetrics, gatedTrials, servChangesMarkdown } from "../gate/eval.js";
import { PROCEDURE_VERSION } from "./prompt.js";
import type { CaseLabel, TimingLabel } from "../packets/types.js";
import { MODELS } from "./client.js";
import type { Arm } from "./client.js";
import type { DevData } from "./dev-data.js";
import { REPETITIONS } from "./run-arm.js";
import type { Trial } from "./run-arm.js";

function cell(value: unknown): string {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

type ScoredTrial = Trial & { gate_final_reason?: string | null };

function correct(trial: ScoredTrial, label: CaseLabel): boolean {
  const verdict = trial.verdict;
  return trial.status === "valid" && verdict !== null && verdict.decision === label.expected_decision && (trial.gate_final_reason === undefined ? verdict.reason : trial.gate_final_reason) === label.expected_reason;
}

function ratio(numerator: number, denominator: number): string {
  return denominator ? `${numerator}/${denominator} (${(100 * numerator / denominator).toFixed(1)}%)` : "n/a";
}

function median(values: number[]): string {
  if (!values.length) return "n/a";
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return `${(value / 1_000).toFixed(2)} s`;
}

function consistent(trials: ScoredTrial[]): boolean {
  return trials.length === REPETITIONS && trials.every((trial) => trial.status === "valid") &&
    new Set(trials.map((trial) => JSON.stringify([trial.verdict?.decision, trial.gate_final_reason === undefined ? trial.verdict?.reason : trial.gate_final_reason]))).size === 1;
}

export interface RunState {
  run: string;
  status: "running" | "finished" | "failed";
  stops: Record<Arm, string | null>;
  arms?: Arm[];
  procedure_version?: string;
  models?: Record<Arm, string>;
}

export function pilotReport(data: DevData, trials: Trial[], state: RunState): string {
  const planned = data.packets.length * REPETITIONS;
  const lines = [
    "# ChallengeLens timing pilot", "",
    `Run: ${cell(state.run)}. Status: ${state.status}. Requested models: raw ${state.models?.raw ?? MODELS.raw}; SERV ${state.models?.serv ?? MODELS.serv}.`,
    `Selected arms: ${(state.arms ?? ["raw", "serv"]).join(", ")}. Procedure ${state.procedure_version ?? PROCEDURE_VERSION}; max_tokens 8000 for every request.`,
    "15 dev cases × 3 repetitions per arm. Same system/user prompts and schema; temperature omitted (provider defaults). Sealed inputs are never loaded.", "",
    "Accuracy requires a valid verdict matching both expected decision and reason. Denominators include all planned trials; invalid, failed, stopped and not-yet-run trials are not correct.",
    "PREMATURE expects NOT_SUPPORTED_NOW/PREMATURE. TIMING_OK expects SUPPORTED_NOW/null for timing only, independent of outcome correctness.", "",
    "| Arm | PREMATURE accuracy | TIMING_OK accuracy | Overall | Valid false SUPPORTED on PREMATURE | All parsed false SUPPORTED claims | Invalid outputs | Request errors | Not run | Abstentions | Consistent cases | p50 HTTP latency |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const rowName of ["raw", "serv", "raw+gate", "serv+gate"] as const) {
    const arm: Arm = rowName.startsWith("raw") ? "raw" : "serv";
    const gated = rowName.endsWith("+gate");
    if (state.arms && !state.arms.includes(arm)) {
      lines.push(`| ${rowName} (not selected) | n/a | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 | n/a | n/a |`);
      continue;
    }
    const originals = trials.filter((trial) => trial.arm === arm);
    const projections = gated ? gatedTrials(data.packets, originals) : [];
    const own: ScoredTrial[] = originals.map((trial, index) => {
      const result = projections[index]?.gated;
      if (!result || !trial.verdict) return gated ? { ...trial, claimed_decision: null } : trial;
      const decision = result.final_decision;
      return { ...trial, gate_final_reason: result.final_reason, verdict: { ...trial.verdict, decision, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null }, claimed_decision: decision };
    });
    function accuracy(label: TimingLabel): string {
      const expected = data.packets.filter((packet) => data.labels.get(packet.case_id)!.label === label).length * REPETITIONS;
      const matches = own.filter((trial) => data.labels.get(trial.case_id)!.label === label && correct(trial, data.labels.get(trial.case_id)!)).length;
      return ratio(matches, expected);
    }
    const premature = own.filter((trial) => data.labels.get(trial.case_id)!.label === "PREMATURE");
    const denominator = [...data.labels.values()].filter((label) => label.label === "PREMATURE").length * REPETITIONS;
    const allCorrect = own.filter((trial) => correct(trial, data.labels.get(trial.case_id)!)).length;
    const validFalse = premature.filter((trial) => trial.status === "valid" && trial.verdict?.decision === "SUPPORTED_NOW").length;
    const allClaims = premature.filter((trial) => trial.claimed_decision === "SUPPORTED_NOW").length;
    const same = data.packets.filter((packet) => consistent(own.filter((trial) => trial.case_id === packet.case_id))).length;
    const notRun = planned - own.filter((trial) => trial.status !== "not_run").length;
    const attempts = own.flatMap((trial) => trial.attempts);
    lines.push(`| ${rowName} | ${accuracy("PREMATURE")} | ${accuracy("TIMING_OK")} | ${ratio(allCorrect, planned)} | ${ratio(validFalse, denominator)} | ${ratio(allClaims, denominator)} | ${own.filter((trial) => trial.status === "invalid").length} | ${own.filter((trial) => trial.status === "error").length} | ${notRun} | ${own.filter((trial) => trial.verdict?.decision === "INSUFFICIENT_EVIDENCE").length} | ${ratio(same, data.packets.length)} | ${median(attempts.map((attempt) => attempt.latency_ms))} |`);
  }
  const gated = gatedMetrics(data.packets, trials, data.labels);
  const offline = gated.arms.find((a) => a.arm === "checks-only")!;
  lines.push(`| checks-only | ${ratio(offline.premature.correct, offline.premature.planned)} | ${ratio(offline.timing_ok.correct, offline.timing_ok.planned)} | ${ratio(offline.correct, offline.planned)} | ${ratio(offline.false_supported, offline.premature.planned)} | ${ratio(offline.false_supported, offline.premature.planned)} | 0 | 0 | 0 | ${offline.abstained} | ${ratio(offline.consistent_cases, offline.cases)} | 0 HTTP calls |`);
  lines.push("", "Checks-only uses code templates and evidence alone: no model cutoff, approval, inference, tokens or cost. Its three identical projections match reporting denominators; repetitions are not independent.", "", servChangesMarkdown(gated.serv_changes));
  lines.push("", "Gated rows reuse the same validated saved responses, with zero extra HTTP calls. BLOCKED_DISAGREEMENT surfaces as NOT_SUPPORTED_NOW. Accuracy and consistency compare the final decision and final reason; a blocked disagreement does not count as a correct PREMATURE reason. Invalid model outputs remain invalid and have no gated SUPPORTED claim. Gated latency/token costs reuse the underlying attempts.", "", "### Gated abstentions by gate_reason", "");
  for (const arm of gated.arms) {
    lines.push(`${arm.arm}: ${Object.entries(arm.abstentions_by_gate_reason).map(([reason, count]) => `${cell(reason)}: ${count}`).join("; ") || "none"}`);
  }
  lines.push("", "| Arm | Case | Repetition | gate_reason |", "| --- | --- | ---: | --- |");
  for (const row of gated.rows) if (row.gated?.final_decision === "INSUFFICIENT_EVIDENCE") lines.push(`| ${row.arm === "checks-only" ? row.arm : `${row.arm}+gate`} | ${cell(row.case_id)} | ${row.repetition} | ${cell(row.gated.gate.gate_reason)} |`);
  lines.push("", "All parsed false SUPPORTED claims include rejected invalid outputs when their first parsed JSON object claimed SUPPORTED_NOW. Malformed/unparseable outputs are counted as invalid.",
    "Consistency means the same valid decision+reason in all three runs of a case; incomplete cases are not consistent. p50 is per actual HTTP attempt, including format fallback/errors, excluding rate-limit waiting.",
    "", "## Usage and collection status", "",
    "| Arm | HTTP attempts | JSON-mode attempts | Plain fallback attempts | Prompt tokens | Completion tokens | Total tokens | Reasoning tokens | Total cost (USD) | Attempts reporting usage | Stop reason |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const arm of ["raw", "serv"] as const) {
    const attempts = trials.filter((trial) => trial.arm === arm).flatMap((trial) => trial.attempts);
    function sum(field: "prompt" | "completion" | "total" | "reasoning" | "cost_usd"): string {
      const reported = attempts.map((attempt) => attempt.usage[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (!reported.length) return "unreported";
      const total = reported.reduce((result, value) => result + value, 0);
      const formatted = field === "cost_usd" ? total.toFixed(8) : String(total);
      return reported.length === attempts.length ? formatted : `${formatted} (partial: ${reported.length}/${attempts.length} attempts)`;
    }
    const reporting = attempts.filter((attempt) => Object.values(attempt.usage).some((value) => typeof value === "number")).length;
    lines.push(`| ${arm} | ${attempts.length} | ${attempts.filter((attempt) => attempt.request_format === "json_schema" || attempt.request_format === "json_object").length} | ${attempts.filter((attempt) => attempt.request_format === "plain").length} | ${sum("prompt")} | ${sum("completion")} | ${sum("total")} | ${sum("reasoning")} | ${sum("cost_usd")} | ${reporting}/${attempts.length} | ${cell(state.stops[arm] ?? "none recorded")} |`);
  }
  lines.push("| checks-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00000000 | 0/0 (no calls) | Offline | ");
  lines.push("", "Token/cost totals sum provider-reported usage only, including format fallback attempts; missing fields are unreported, never zero. Cost uses usage.cost in USD. Reasoning tokens use completion_tokens_details.reasoning_tokens (or usage.reasoning_tokens) and are not added again to total tokens. Partial costs do not support a cheaper-arm claim. New JSON-mode calls use json_schema strict.", "");
  for (const arm of ["raw", "serv"] as const) {
    if (state.arms && !state.arms.includes(arm)) continue;
    lines.push(`## ${arm}: per-case results`, "",
      "| Case / title | Category | Label | Outcome flipped | Run 1 | Run 2 | Run 3 | Correct | Consistent |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const packet of data.packets) {
      const label = data.labels.get(packet.case_id)!;
      const own = trials.filter((trial) => trial.arm === arm && trial.case_id === packet.case_id);
      const outputs = [1, 2, 3].map((repetition) => {
        const trial = own.find((item) => item.repetition === repetition);
        if (!trial) return "NOT_RUN";
        return trial.status === "valid" ? `${trial.verdict!.decision}/${trial.verdict!.reason ?? "null"}`
          : `${trial.status.toUpperCase()}${trial.errors.length ? `: ${cell(trial.errors.join("; "))}` : ""}`;
      });
      lines.push(`| ${packet.case_id}: ${cell(packet.model_inputs.title)} | ${packet.category} | ${label.label} | ${label.outcome_flipped} | ${outputs.join(" | ")} | ${own.filter((trial) => correct(trial, label)).length}/3 | ${consistent(own)} |`);
    }
    lines.push("");
  }
  lines.push("## Interpretation limits", "",
    "- Labels follow the instructed oracle-settlement mapping. Binary equality/flip is a timing proxy, not independent proof of timing at the proposal instant.",
    "- Rules are decoded ancillary base bytes; historical authoritative clarifications and receipts are not verified. Current Gamma scheduling can disagree with historical rules.",
    "- Selection is restricted to fixed-time heuristic matches, excluding by/before-date YES propositions. Candle-close, timezone and inclusive-end conventions need checking. A scheduled start plus a conservative duration estimates game end; it does not prove actual completion or handle postponements. The gate never treats an estimated sports end as proof of completion; saved older SERV judgments are retained for comparison.",
    "- Fifteen cases, capped per event, are a development pilot. Repeated runs are not independent events; no significance or generalization claims are made.",
    "- Providers use different IDs for the requested model family; defaults/aliases may differ. Compare the stored responses. No evidence of an OpenServ advantage is assumed.", "");
  return lines.join("\n");
}
