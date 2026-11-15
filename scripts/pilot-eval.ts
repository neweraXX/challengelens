import { attachEvidence, loadEvidence } from "../src/evidence/collect.js";
import { actionMarkdown } from "../src/gate/metrics.js";
import { GATE_VERSION } from "../src/gate/decide.js";
import { gatedMetrics } from "../src/gate/eval.js";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { safeMessage } from "../src/collect/http.js";
import { canonicalJson } from "../src/packets/canonical.js";
import { CALL_INTERVAL_MS, InferenceClient, MAX_TOKENS, MODELS, pilotArms } from "../src/judge/client.js";
import { loadDevData } from "../src/judge/dev-data.js";
import { PROCEDURE_SHA256, PROCEDURE_VERSION, SYSTEM_PROMPT } from "../src/judge/prompt.js";
import { pilotReport } from "../src/judge/report.js";
import type { RunState } from "../src/judge/report.js";
import { REPETITIONS, runArm } from "../src/judge/run-arm.js";
import type { Trial } from "../src/judge/run-arm.js";
import { VERDICT_SCHEMA } from "../src/judge/schema.js";

async function atomic(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text, "utf8");
  await rename(`${path}.tmp`, path);
}

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("Usage: npm run pilot:eval (fixed dev paths only; no sealed option)");
  const data = await loadDevData();
  const evidence = await loadEvidence("data/dev/evidence.jsonl");
  data.packets = attachEvidence(data.packets, evidence); // Validate paths, input allowlist and hashes before any HTTP.
  const arms = pilotArms(process.env.PILOT_ARMS ?? "raw,serv");
  // Validate only selected arms' credentials, before spending on either arm.
  const clients = new Map(arms.map((arm) => [arm, new InferenceClient(arm)] as const));
  const timestamp = new Date().toISOString();
  const run = `pilot-${timestamp.replace(/[:.]/gu, "-")}`;
  const directory = `eval/runs/${run}`;
  await mkdir("eval/runs", { recursive: true });
  await mkdir("eval/reports", { recursive: true });
  await mkdir(directory); // Do not overwrite an existing run.
  for (const arm of arms) await mkdir(`${directory}/${arm}`);
  const config = {
    schema_version: "timing-pilot-2", started_at: timestamp, models: MODELS, max_tokens: MAX_TOKENS,
    repetitions: REPETITIONS, planned_trials_per_arm: data.packets.length * REPETITIONS,
    procedure_version: PROCEDURE_VERSION, procedure_sha256: PROCEDURE_SHA256, gate_version: GATE_VERSION,
    verdict_schema: VERDICT_SCHEMA, system_prompt: SYSTEM_PROMPT,
    packet_file_sha256: data.packetFileHash, label_file_sha256: data.labelFileHash,
    raw_minimum_call_interval_ms: CALL_INTERVAL_MS.raw, serv_minimum_call_interval_ms: CALL_INTERVAL_MS.serv,
    temperature: "provider default; field omitted", response_format: "json_schema strict with explicit unsupported-format plain fallback",
    retries: "none; 402/429 stop the affected arm; format fallback is a separately paced HTTP request",
    arm_order: arms, case_order: data.packets.map((packet) => packet.case_id),
  };
  await writeFile(`${directory}/config.json`, JSON.stringify(config, null, 2) + "\n", "utf8");
  await writeFile(`${directory}/inputs.jsonl`, data.packets.map((packet) => canonicalJson({
    case_id: packet.case_id, packet_hash: packet.packet_hash, model_inputs: packet.model_inputs,
  })).join("\n") + "\n", "utf8");
  // Grading labels remain a separate artifact and are never given to the client.
  await writeFile(`${directory}/labels.jsonl`, [...data.labels.values()].map(canonicalJson).join("\n") + "\n", "utf8");
  await writeFile(`${directory}/evidence.jsonl`, evidence.map(canonicalJson).join("\n") + "\n");
  const trials: Trial[] = [];
  const state: RunState = { run, procedure_version: PROCEDURE_VERSION, models: MODELS, status: "running", arms,
    stops: { raw: arms.includes("raw") ? null : "Not selected (PILOT_ARMS)", serv: arms.includes("serv") ? null : "Not selected (PILOT_ARMS)" } };
  async function checkpoint(): Promise<void> {
    await atomic(`${directory}/results.json`, JSON.stringify({ state, trials }, null, 2) + "\n");
    await atomic(`${directory}/gated-results.json`, JSON.stringify(gatedMetrics(data.packets, trials, data.labels), null, 2) + "\n");
    const report = pilotReport(data, trials, state) + "\nAction metrics (case-majority Wilson intervals):\n\n" + gatedMetrics(data.packets, trials, data.labels).arms.map((a) => `\n${a.arm}\n\n| Action metric | Result |\n| --- | --- |\n${actionMarkdown(a.action_metrics)}\n`).join("\n");
    await atomic(`${directory}/report.md`, report);
    await atomic("eval/reports/pilot.md", report);
  }
  await checkpoint();
  try {
    for (const arm of arms) {
      console.log(`${arm}: starting ${data.packets.length} dev cases × ${REPETITIONS}; ${CALL_INTERVAL_MS[arm] / 1_000}s minimum call interval.`);
      const outcome = await runArm(arm, clients.get(arm)!, data.packets,
        async (trial, attempt, number) => {
          const path = `${directory}/${arm}/${trial.case_id}-r${trial.repetition}-a${number}.json`;
          await writeFile(path, JSON.stringify({
            arm, model: MODELS[arm], max_tokens: MAX_TOKENS, case_id: trial.case_id, packet_hash: trial.packet_hash, evidence_hash: trial.evidence_hash,
            repetition: trial.repetition, attempt_number: number, ...attempt,
          }, null, 2) + "\n", "utf8");
        },
        async (trial) => {
          trials.push(trial);
          await checkpoint();
          if (trial.status !== "not_run") console.log(`${arm} ${trial.case_id} r${trial.repetition}: ${trial.status}`);
        });
      state.stops[arm] = outcome.stop_reason;
      if (outcome.stop_reason) console.warn(outcome.stop_reason);
      await checkpoint();
    }
    state.status = "finished";
    if (trials.some((trial) => trial.status === "invalid" || trial.status === "error" || trial.status === "not_run")) process.exitCode = 1;
  } catch (error) {
    state.status = "failed";
    throw error;
  } finally {
    await checkpoint();
  }
  console.log(`Saved every attempt under ${directory}; report: eval/reports/pilot.md`);
}

main().catch((error: unknown) => {
  console.error(`Pilot evaluation failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});
