import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROCEDURE_SHA256 } from "../src/judge/prompt.js";
import { GATE_VERSION } from "../src/gate/decide.js";
import type { CaseLabel } from "../src/packets/types.js";
import type { SavedInput } from "../src/gate/eval.js";
import type { Trial } from "../src/judge/run-arm.js";
import type { SealedEvidence } from "../src/demo/types.js";
import { servChanges } from "../src/gate/eval.js";
import { sealedAggregates, sealedSplit, sealedMarkdown } from "./sealed-support.js";

/** Reads saved evaluation artifacts only. No sealed dataset mount or inference. */
async function main() {
  if (process.argv.length > 3) throw new Error("Usage: sealed-publish [sealed|sealed2]");
  const split = sealedSplit(process.argv[2] ?? process.env.SEALED_SPLIT);
  const directory = resolve(`eval/${split}`, PROCEDURE_SHA256.slice(0, 12));
  const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(resolve(directory, file), "utf8")) as T;
  const jsonl = async <T>(file: string): Promise<T[]> => (await readFile(resolve(directory, file), "utf8")).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
  const freeze = await json<Pick<SealedEvidence, "procedure_version" | "procedure_sha256" | "gate_version" | "models" | "date" | "blind" | "note" | "split">>("freeze.json");
  if (freeze.split !== split) throw new Error("Frozen split differs from selected split");
  if (freeze.procedure_sha256 !== PROCEDURE_SHA256 || freeze.gate_version !== GATE_VERSION) throw new Error("Frozen procedure or gate differs from the current implementation");
  const results = await json<{ state: { status: string; arms: ("raw" | "serv")[] }; trials: Trial[] }>("results.json");
  if (!["finished", "incomplete", "failed"].includes(results.state.status)) throw new Error("Evaluation still running; publication refused");
  const arms = results.state.arms;
  if (!arms.length || arms.some((arm) => !["raw", "serv"].includes(arm)) || new Set(arms).size !== arms.length) throw new Error("Invalid saved arms");
  const models: Record<string, string> = {};
  for (const arm of arms) { const model = freeze.models[arm]; if (typeof model !== "string" || !model) throw new Error("Missing frozen model"); models[arm] = model; }
  const inputs = await jsonl<SavedInput>("inputs.jsonl");
  const labels = new Map((await jsonl<CaseLabel>("labels.jsonl")).map((label) => [label.case_id, label]));
  const aggregates = sealedAggregates(inputs, results.trials, labels, arms);
  // Explicit allowlist: no spreading saved objects or exporting case IDs/text, verdicts, or attempts.
  const published: SealedEvidence = {
    split, serv_changes: servChanges(inputs, results.trials), procedure_version: freeze.procedure_version, procedure_sha256: freeze.procedure_sha256, gate_version: freeze.gate_version,
    models, date: freeze.date, blind: freeze.blind ?? true, ...(freeze.note ? { note: freeze.note } : {}),
    calls: { planned: inputs.length * 3 * arms.length, completed: results.trials.filter((trial) => trial.status === "valid" || trial.status === "invalid").length, invalid_raw: results.trials.filter((trial) => trial.arm === "raw" && trial.status === "invalid").length, invalid_serv: results.trials.filter((trial) => trial.arm === "serv" && trial.status === "invalid").length },
    status: results.state.status, unit: "CASE-majority; Wilson 95%; repetitions are not independent", arms: aggregates,
  };
  const all: SealedEvidence[] = [published];
  for (const oldSplit of ["sealed", "sealed2"] as const) for (const entry of await readdir(`eval/${oldSplit}`, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; })) {
    if (!entry.isDirectory() || resolve(`eval/${oldSplit}`, entry.name) === directory) continue;
    const old = JSON.parse(await readFile(resolve(`eval/${oldSplit}`, entry.name, "aggregate.json"), "utf8")) as SealedEvidence;
    // Prior procedures retain their original gate results. Never regate the blind baseline.
    all.push({ split: oldSplit, ...(old.serv_changes ? { serv_changes: old.serv_changes } : {}), procedure_version: old.procedure_version, procedure_sha256: old.procedure_sha256, gate_version: old.gate_version,
      models: Object.fromEntries(Object.entries(old.models).filter(([k, v]) => ["raw", "serv"].includes(k) && typeof v === "string")),
      date: old.date, ...(old.calls ? { calls: old.calls } : {}), status: old.status, unit: old.unit, blind: old.blind ?? true, ...(old.note ? { note: old.note } : {}),
      arms: old.arms.map((a) => ({ arm: a.arm, correct: a.correct, false_approvals: a.false_approvals, abstentions: a.abstentions, consistency: a.consistency,
        tokens: a.tokens, recorded_cost_usd: a.recorded_cost_usd, cost_complete: a.cost_complete, cost_attempts: a.cost_attempts, attempts: a.attempts, completed_cases: a.completed_cases, cases: a.cases,
        ...(a.action_metrics ? { action_metrics: a.action_metrics } : {}) })) });
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir("web/public/data", { recursive: true });
  await writeFile("web/public/data/sealed.json.tmp", JSON.stringify(all, null, 2) + "\n");
  await rename("web/public/data/sealed.json.tmp", "web/public/data/sealed.json");
  await writeFile("web/public/data/sealed.md", all.map((run) => `Split: ${run.split}\n\n${sealedMarkdown(run)}`).join("\n\n"));
  await writeFile("web/public/data/procedure.json", JSON.stringify({ procedure_version: freeze.procedure_version }) + "\n");
  console.log("Published sealed aggregates only; 0 inference calls.");
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-sealed.ts")) {
  main().catch(() => { console.error("Sealed publication refused. Verify the saved run and frozen procedure/gate privately."); process.exitCode = 1; });
}
