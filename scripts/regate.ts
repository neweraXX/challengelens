import { attachEvidence, loadEvidence } from "../src/evidence/collect.js";
import { actionMarkdown } from "../src/gate/metrics.js";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import type { CaseLabel, CasePacket } from "../src/packets/types.js";
import type { Trial } from "../src/judge/run-arm.js";
import { gatedMetrics } from "../src/gate/eval.js";
import type { SavedInput } from "../src/gate/eval.js";
import { pilotReport } from "../src/judge/report.js";
import type { RunState } from "../src/judge/report.js";

async function main() {
  const argument = process.argv[2];
  if (!argument || (process.argv.length !== 3 && !(process.argv.length === 4 && process.argv[3] === "--with-evidence"))) throw new Error("Usage: ./node_modules/.bin/tsx scripts/regate.ts eval/runs/<run> [--with-evidence]");
  const root = resolve("eval/runs"); const directory = resolve(argument); const child = relative(root, directory);
  if (!child || child.startsWith("..") || child.includes(sep)) throw new Error("Choose one direct child of eval/runs");
  if (await realpath(directory) !== directory || await realpath(root) !== root) throw new Error("Run directory must not be a symlink");
  const read = async (name: string) => readFile(resolve(directory, name), "utf8");
  const jsonl = <T>(text: string): T[] => text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);
  let inputs = jsonl<SavedInput>(await read("inputs.jsonl"));
  let evidence = process.argv.includes("--with-evidence") ? await loadEvidence(resolve(directory, "evidence.jsonl")) : [];
  if (process.argv.includes("--with-evidence") && !evidence.length) evidence = await loadEvidence("data/dev/evidence.jsonl");
  inputs = attachEvidence(inputs, evidence);
  const labels = new Map(jsonl<CaseLabel>(await read("labels.jsonl")).map((label) => [label.case_id, label]));
  const saved = JSON.parse(await read("results.json")) as { state: RunState; trials: Trial[] };
  const config = JSON.parse(await read("config.json")) as { models: RunState["models"]; procedure_version: string; repetitions: number };
  if (config.repetitions !== 3) throw new Error("Report expects three repetitions");
  const note = process.argv.includes("--with-evidence") ? "Evidence regating: saved responses are reused; recomputed evidence may differ from what the models originally saw. No inference rerun." : "Evidence disabled: saved responses regated with the current gate. No inference rerun.";
  const metrics = gatedMetrics(inputs, saved.trials, labels, config.repetitions);
  await writeFile(resolve(directory, "gated-results.json"), JSON.stringify({ ...metrics, with_evidence: process.argv.includes("--with-evidence"), note }, null, 2) + "\n");
  if (process.argv.includes("--with-evidence")) await writeFile(resolve(directory, "evidence.jsonl"), evidence.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // Only fields used by the report; no original dataset is loaded.
  const packets = inputs.map((input) => ({ ...input, category: "other" })) as CasePacket[];
  const reportData = { packets, labels } as Parameters<typeof pilotReport>[0];
  const state = { ...saved.state, ...(config.models ? { models: config.models } : {}), procedure_version: config.procedure_version };
  await writeFile(resolve(directory, "regated-report.md"), pilotReport(reportData, saved.trials, state) + `\n${note}\n` + metrics.arms.map((a) => `\n${a.arm}\n\n| Action metric | Result |\n| --- | --- |\n${actionMarkdown(a.action_metrics)}\n`).join("\n"));
  console.log(`Saved gated-results.json and regated-report.md in ${child}; 0 inference calls.`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Offline regating failed"); process.exitCode = 1; });
