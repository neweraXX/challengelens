import { attachEvidence, loadEvidence } from "../src/evidence/collect.js";
import { actionMetrics } from "../src/gate/metrics.js";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { gatedMetrics, gateMetricsMarkdown } from "../src/gate/eval.js";
import { GATE_VERSION } from "../src/gate/decide.js";
import type { SavedInput, SavedTrial } from "../src/gate/eval.js";
import type { CaseLabel } from "../src/packets/types.js";
import type { BenchmarkArm, BenchmarkModel, MultiBenchmark } from "../src/demo/types.js";
import { PROCEDURE_VERSION } from "../src/judge/prompt.js";

interface Trial extends SavedTrial { attempts: { usage: { total: number | null; cost_usd?: number | null } }[] }
export async function writeBenchmark(directories: string[], output = "web/public/data/benchmark.json"): Promise<void> {
  if (!directories.length) throw new Error("Supply one or more regated eval/runs/<run> directories.");
  const root = await realpath("eval/runs"); const models: BenchmarkModel[] = []; const reports: string[] = [];
  for (const argument of directories) {
    const directory = await realpath(argument); const name = relative(root, directory);
    if (!name || name.startsWith("..") || name.includes(sep)) throw new Error("Benchmark inputs must be direct children of eval/runs.");
    const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(resolve(directory, file), "utf8")) as T;
    const jsonl = async <T>(file: string): Promise<T[]> => (await readFile(resolve(directory, file), "utf8")).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
    const config = await json<{ models?: Record<string, string>; repetitions: number; procedure_version: string }>("config.json");
    if (config.repetitions !== 3) throw new Error("Benchmark expects three repetitions.");
    const original = await json<{ trials: Trial[] }>("results.json");
    const savedGate = await json<{ gate_version: string; with_evidence?: boolean }>("gated-results.json");
    if (savedGate.gate_version !== GATE_VERSION) throw new Error("Regate the run with the current gate first.");
    let inputs = await jsonl<SavedInput>("inputs.jsonl");
    if (savedGate.with_evidence !== undefined) inputs = attachEvidence(inputs, savedGate.with_evidence ? await loadEvidence(resolve(directory, "evidence.jsonl")) : []);
    const labels = new Map((await jsonl<CaseLabel>("labels.jsonl")).map((l) => [l.case_id, l]));
    const gated = gatedMetrics(inputs, original.trials, labels, config.repetitions);
    reports.push(`# ${name} · ${config.procedure_version} · ${GATE_VERSION}\n\n${gateMetricsMarkdown(gated)}`);
    const groups = new Map<string, BenchmarkModel>();
    for (const arm of ["raw", "serv"] as const) {
      const own = original.trials.filter((trial) => trial.arm === arm);
      if (!own.length) continue;
      const model = (config.models?.[arm] ?? `Unrecorded ${arm} model`).replace(/^google\//u, "");
      let group = groups.get(model);
      if (!group) { group = { model, run: name, procedure: config.procedure_version, source: `eval/runs/${name}/gated-results.json`, rows: { raw: null, serv: null, "raw+gate": null, "serv+gate": null } }; groups.set(model, group); }
      const attempts = own.flatMap((t) => t.attempts); const costs = attempts.map((a) => a.usage.cost_usd);
      const usage = { cost_usd: costs.length && costs.every((c): c is number => typeof c === "number") ? costs.reduce((a, b) => a + b, 0) : null,
        tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage.total ?? 0), 0) };
      const metric = gated.arms.find((m) => m.arm === `${arm}+gate`)!;
      const base: BenchmarkArm = { action_metrics: actionMetrics(inputs, own.map((r) => ({ case_id: r.case_id, action: r.status === "valid" && r.verdict ? r.verdict.decision === "SUPPORTED_NOW" ? "PROCEED" : r.verdict.reason === "PREMATURE" ? "WAIT" : "NEED_EVIDENCE" : null })), labels), trials: inputs.length * config.repetitions, valid: own.filter((t) => t.status === "valid").length,
        false_supported: own.filter((t) => t.status === "valid" && labels.get(t.case_id)!.label === "PREMATURE" && t.verdict?.decision === "SUPPORTED_NOW").length,
        premature_trials: inputs.filter((i) => labels.get(i.case_id)!.label === "PREMATURE").length * config.repetitions,
        correct: own.filter((t) => t.status === "valid" && t.verdict?.decision === labels.get(t.case_id)!.expected_decision && t.verdict.reason === labels.get(t.case_id)!.expected_reason).length,
        abstained: own.filter((t) => t.status === "valid" && t.verdict?.decision === "INSUFFICIENT_EVIDENCE").length,
        consistent_cases: inputs.filter((i) => { const rows = own.filter((t) => t.case_id === i.case_id); return rows.length === 3 && rows.every((t) => t.status === "valid") && new Set(rows.map((t) => JSON.stringify([t.verdict?.decision, t.verdict?.reason]))).size === 1; }).length,
        cases: inputs.length, ...usage };
      group.rows[arm] = base;
      group.rows[`${arm}+gate`] = { ...base, action_metrics: metric.action_metrics, correct_abstained: 0, valid: metric.valid, correct: metric.correct, false_supported: metric.false_supported, abstained: metric.abstained, consistent_cases: metric.consistent_cases };
    }
    const offline = gated.arms.find((m) => m.arm === "checks-only")!;
    for (const group of groups.values()) {
      group.serv_changes = gated.serv_changes;
      group.rows["checks-only"] = { action_metrics: offline.action_metrics, trials: offline.planned, valid: offline.valid,
        false_supported: offline.false_supported, premature_trials: offline.premature.planned, correct: offline.correct,
        abstained: offline.abstained, consistent_cases: offline.consistent_cases, cases: offline.cases, tokens: 0, cost_usd: 0 };
    }
    models.push(...groups.values());
  }
  const benchmark: MultiBenchmark = { label: "Development set · saved checks and deterministic gate", sealed: "pending", models, procedure_version: PROCEDURE_VERSION };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(benchmark, null, 2) + "\n");
  await writeFile(resolve(output, "../benchmark.md"), reports.join("\n\n"));
  await writeFile(resolve(output, "../procedure.json"), JSON.stringify({ procedure_version: PROCEDURE_VERSION }) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-benchmark.ts")) {
  writeBenchmark(process.argv.slice(2)).then(() => console.log("Wrote benchmark.json from regated runs; 0 inference calls."))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Benchmark generation failed"); process.exitCode = 1; });
}
