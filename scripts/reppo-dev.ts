import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { resolve, relative, sep, basename } from "node:path";
import { sha256 } from "../src/packets/canonical.js";
import { gatedTrials } from "../src/gate/eval.js";
import type { SavedInput, SavedTrial } from "../src/gate/eval.js";
import { GATE_VERSION } from "../src/gate/decide.js";
import type { CaseLabel } from "../src/packets/types.js";
import { formatReppoInput } from "../src/reppo/format.js";
import { ReppoClient, ReppoError } from "../src/reppo/client.js";
import type { ReppoEvaluation } from "../src/reppo/client.js";

async function exactRead(directory: string, name: string): Promise<string> {
  const path = resolve(directory, name); const actual = await realpath(path);
  if (actual !== path || /(?:^|[\\/])sealed(?:[\\/]|$)/iu.test(actual)) throw new Error("Refusing symlink or sealed path");
  return readFile(actual, "utf8");
}
async function atomic(path: string, value: unknown) { const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); await rename(temp, path); }
interface SavedReview { case_id: string; run: string; arm: string; repetition: number; packet_hash: string; gate_version: string; input: string; input_sha256: string; eval_id?: string; evaluation?: ReppoEvaluation; submission_state: string; error?: string }
async function main() {
  const args = process.argv.slice(2); const argument = args.shift(); let limit = 6;
  const option = args.indexOf("--max"); if (option >= 0) { limit = Number(args[option + 1]); args.splice(option, 2); }
  if (!argument || !Number.isSafeInteger(limit) || limit < 1 || args.length > limit || args.some((v) => !/^timing-[a-z0-9-]+$/u.test(v))) throw new Error("Usage: reppo-dev eval/runs/<regated-dev-run> [--max N] [case_id ...]");
  if (/sealed/iu.test(argument)) throw new Error("Sealed paths are forbidden");
  const root = await realpath("eval/runs"); const directory = await realpath(argument); const run = relative(root, directory);
  if (!run || run.startsWith("..") || run.includes(sep) || directory !== resolve(argument)) throw new Error("Choose a direct, non-symlink child of eval/runs");
  const lines = <T>(text: string): T[] => text.trim().split(/\r?\n/u).filter(Boolean).map((l) => JSON.parse(l) as T);
  const devDirectory = await realpath("data/dev");
  if (devDirectory !== resolve("data/dev")) throw new Error("Dev allowlist directory must not be a symlink");
  const dev = new Map(lines<{ case_id: string; packet_hash: string }>(await exactRead(devDirectory, "packets.jsonl")).map((p) => [p.case_id, p.packet_hash]));
  const inputs = lines<SavedInput>(await exactRead(directory, "inputs.jsonl"));
  if (!inputs.length || inputs.some((p) => dev.get(p.case_id) !== p.packet_hash)) throw new Error("Run is not exclusively the current dev split; no calls sent");
  const labels = new Map(lines<CaseLabel>(await exactRead(directory, "labels.jsonl")).map((l) => [l.case_id, l]));
  if (inputs.some((p) => labels.get(p.case_id)?.packet_hash !== p.packet_hash)) throw new Error("Dev labels do not match inputs");
  const regated = JSON.parse(await exactRead(directory, "gated-results.json")) as { gate_version: string };
  if (regated.gate_version !== GATE_VERSION) throw new Error("Regate this dev run with the current gate first");
  const saved = JSON.parse(await exactRead(directory, "results.json")) as { trials: SavedTrial[] };
  const rows = gatedTrials(inputs, saved.trials).filter((t) => t.gated && t.verdict).sort((a, b) => Number(b.arm === "serv") - Number(a.arm === "serv") || a.repetition - b.repetition);
  const wrong = (row: typeof rows[number]) => row.gated!.final_decision !== labels.get(row.case_id)!.expected_decision || row.gated!.final_reason !== labels.get(row.case_id)!.expected_reason;
  const selected: typeof rows = [];
  const requested = args.length ? args : [...new Set(rows.filter(wrong).map((t) => t.case_id))].slice(0, limit);
  for (const id of requested) {
    if (!dev.has(id)) throw new Error("Requested case is not in the dev split; no calls sent");
    const own = rows.filter((row) => row.case_id === id); const row = own.find(wrong) ?? own[0];
    if (!row) throw new Error("Requested dev case has no valid saved trial");
    if (!selected.some((t) => t.case_id === id)) selected.push(row);
  }
  if (!selected.length) { console.log("No wrong or abstaining valid dev trials; 0 Reppo calls."); return; }
  const output = resolve("eval/reppo", basename(run)); await mkdir(output, { recursive: true });
  if (await realpath(output) !== output) throw new Error("Output must not be a symlink");
  const plans: { record: SavedReview; path: string }[] = [];
  // Preflight the entire batch before spending any credits. Keep older critiques
  // by input digest when a later gate/procedure changes the AI response.
  for (const trial of selected) {
    const input = formatReppoInput({ ...trial.gated!, model_inputs: inputs.find((i) => i.case_id === trial.case_id)!.model_inputs, serv_verdict: trial.verdict });
    const path = resolve(output, `${trial.case_id}.json`); const input_sha256 = sha256(input);
    let record: SavedReview | null = null;
    try {
      const old = JSON.parse(await exactRead(output, `${trial.case_id}.json`)) as SavedReview;
      if (!/^[0-9a-f]{64}$/u.test(old.input_sha256) || old.case_id !== trial.case_id || old.run !== run) throw new Error("Saved review identity is invalid");
      if (old.input_sha256 === input_sha256) record = old;
      else await atomic(resolve(output, `${old.case_id}-${old.input_sha256}.json`), old);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!record) {
      try { record = JSON.parse(await exactRead(output, `${trial.case_id}-${input_sha256}.json`)) as SavedReview; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    record ??= { case_id: trial.case_id, run, arm: trial.arm, repetition: trial.repetition, packet_hash: trial.packet_hash, gate_version: GATE_VERSION, input, input_sha256, submission_state: "NEW" };
    if (record.input_sha256 !== input_sha256 || record.case_id !== trial.case_id || record.run !== run) throw new Error("Saved review identity is invalid");
    if (!record.eval_id && !["NEW", "NOT_QUEUED"].includes(record.submission_state)) throw new Error("Uncertain prior submission must be reconciled before retrying");
    plans.push({ record, path });
  }
  const client = new ReppoClient(); const results = plans.map((p) => p.record);
  async function persist(path: string, record: SavedReview) {
    await atomic(path, record);
    await atomic(resolve(output, `${record.case_id}-${record.input_sha256}.json`), record);
  }
  // Explicit batch: several evaluations may be in flight. Existing evaluations
  // with the same input digest are resumed, never bought again automatically.
  await Promise.all(plans.map(async ({ record, path }) => {
    try {
      if (!record.eval_id) {
        record.submission_state = "RESERVED"; delete record.error; await persist(path, record);
        const evaluation = await client.submit(record.input); record.eval_id = evaluation.id; record.evaluation = evaluation; record.submission_state = "QUEUED"; await persist(path, record);
      }
      if (record.evaluation?.status !== "COMPLETED" && record.evaluation?.status !== "FAILED") {
        const evaluation = await client.get(record.eval_id);
        record.evaluation = evaluation; await persist(path, record);
        if (evaluation.status !== "COMPLETED" && evaluation.status !== "FAILED") record.evaluation = await client.poll(record.eval_id, async (e) => { record.evaluation = e; await persist(path, record); });
      }
      delete record.error; await persist(path, record);
    } catch (error) {
      record.error = error instanceof ReppoError ? error.message : "Review failed; inspect the saved state before retrying";
      if (!record.eval_id) record.submission_state = error instanceof ReppoError && error.notQueued ? "NOT_QUEUED" : "UNCERTAIN";
      await persist(path, record); process.exitCode = 1;
    }
  }));
  const cell = (v: unknown) => String(v ?? "pending").replace(/\|/gu, "\\|").replace(/[\r\n]/gu, " ").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const summary = ["# Reppo dev feedback", "", `Dev split only. Gate ${GATE_VERSION}. One saved model trial per case. No new SERV calls.`, "", "| Case | Eval ID | Score | Route | Reason | Rubric |", "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.case_id} | ${cell(r.eval_id)} | ${cell(r.evaluation?.score)} | ${cell(r.evaluation?.route)} | ${cell(r.evaluation?.result?.reason ?? r.error)} | ${cell(JSON.stringify(r.evaluation?.result?.rubric_scores ?? null))} |`), ""];
  await writeFile(resolve(output, "summary.md"), summary.join("\n"));
  console.log(`Saved ${results.length} dev reviews under eval/reppo/${run}; existing evaluations reused. No SERV calls.`);
}
main().catch((error: unknown) => { console.error(error instanceof ReppoError ? error.message : error instanceof Error && !/key|token|proxy|https?:/iu.test(error.message) ? error.message : "Reppo dev feedback failed; details withheld"); process.exitCode = 1; });
