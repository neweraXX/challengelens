import { attachEvidence, loadEvidence } from "../src/evidence/collect.js";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GATE_VERSION } from "../src/gate/decide.js";
import { gatedMetrics, servChanges } from "../src/gate/eval.js";
import { canonicalJson, inputHash, sha256 } from "../src/packets/canonical.js";
import { CALL_INTERVAL_MS, InferenceClient, MAX_TOKENS, MODELS, pilotArms } from "../src/judge/client.js";
import { assertModelInputs } from "../src/judge/dev-data.js";
import { PROCEDURE_SHA256, PROCEDURE_VERSION, SYSTEM_PROMPT } from "../src/judge/prompt.js";
import { REPETITIONS, runArm } from "../src/judge/run-arm.js";
import type { Trial } from "../src/judge/run-arm.js";
import { VERDICT_SCHEMA } from "../src/judge/schema.js";
import type { CaseLabel, CasePacket } from "../src/packets/types.js";
import type { SealedEvidence } from "../src/demo/types.js";
import { confirmSealed, reserveSealed, sealedSplit, sealedAggregates, sealedMarkdown } from "./sealed-support.js";

const jsonl = <T>(text: string): T[] => text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T);

/** Called only after explicit fingerprint confirmation. Never prints dataset contents. */
async function loadSealed(split: "sealed" | "sealed2") {
  const directory = resolve(`data/${split}`);
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Sealed directory must not be a symlink");
  const files = await readdir(directory, { withFileTypes: true });
  const packetFile = files.find((file) => file.name === "packets.jsonl" && file.isFile());
  const labelFiles = files.filter((file) => /^labels(?:[.-][a-z0-9_-]+)?\.jsonl$/u.test(file.name) && file.isFile());
  if (!packetFile || labelFiles.length !== 1) throw new Error("Expected packets.jsonl and exactly one labels JSONL file in sealed directory");
  const packetText = await readFile(resolve(directory, packetFile.name), "utf8");
  const labelText = await readFile(resolve(directory, labelFiles[0]!.name), "utf8");
  const packets = jsonl<CasePacket>(packetText); const labelRows = jsonl<CaseLabel>(labelText);
  const labels = new Map(labelRows.map((label) => [label.case_id, label]));
  if (!packets.length || labels.size !== labelRows.length || packets.length !== labels.size || new Set(packets.map((packet) => packet.case_id)).size !== packets.length) throw new Error("Invalid sealed case/label coverage");
  for (const packet of packets) {
    assertModelInputs(packet.model_inputs);
    const label = labels.get(packet.case_id);
    if (!/^timing-[a-z0-9-]+$/u.test(packet.case_id) || packet.packet_hash !== inputHash(packet.model_inputs) || label?.packet_hash !== packet.packet_hash) throw new Error("Sealed identity/hash validation failed");
    if (!label || !["PREMATURE", "TIMING_OK"].includes(label.label) || !["SUPPORTED_NOW", "NOT_SUPPORTED_NOW", "INSUFFICIENT_EVIDENCE"].includes(label.expected_decision) || ![null, "PREMATURE"].includes(label.expected_reason)) throw new Error("Invalid sealed label");
  }
  return { packets, labels, packetFileHash: sha256(packetText), labelFileHash: sha256(labelText) };
}

async function main() {
  if (process.argv.length > 3) throw new Error("Usage: sealed-eval [sealed|sealed2]");
  const split = sealedSplit(process.argv[2] ?? process.env.SEALED_SPLIT);
  const root = `eval/${split}`;
  confirmSealed(process.env.SEALED_CONFIRM, PROCEDURE_SHA256); // Before filesystem data access or client creation.
  const arms = pilotArms(process.env.SEALED_ARMS ?? "raw,serv");
  if (split === "sealed2" && arms.length !== 2) throw new Error("The blind holdout2 run requires raw,serv");
  const clients = new Map(arms.map((arm) => [arm, new InferenceClient(arm)] as const));
  const directory = await reserveSealed("eval", PROCEDURE_SHA256, split); // Atomic, also rejects partial prior runs.
  const previous = (await readdir(root, { withFileTypes: true })).some((e) => e.isDirectory() && resolve(root, e.name) !== resolve(directory));
  const freeze = { split, offline_arms: ["checks-only"], blind: !previous, ...(previous ? { note: "Second look: this split has a prior procedure reservation; it is no longer a fresh blind holdout." } : {}), procedure_version: PROCEDURE_VERSION, procedure_sha256: PROCEDURE_SHA256, gate_version: GATE_VERSION,
    models: Object.fromEntries(arms.map((arm) => [arm, MODELS[arm]])), date: new Date().toISOString() };
  await writeFile(`${directory}/freeze.json`, JSON.stringify(freeze, null, 2) + "\n", { flag: "wx" });
  const data = await loadSealed(split);
  const evidence = await loadEvidence(`data/${split}/evidence.jsonl`);
  data.packets = attachEvidence(data.packets, evidence);
  await writeFile(`${directory}/evidence.jsonl`, evidence.map(canonicalJson).join("\n") + "\n");
  await writeFile(`${directory}/config.json`, JSON.stringify({ ...freeze, repetitions: REPETITIONS, max_tokens: MAX_TOKENS,
    system_prompt: SYSTEM_PROMPT, verdict_schema: VERDICT_SCHEMA, arm_order: arms, minimum_call_interval_ms: CALL_INTERVAL_MS,
    packet_file_sha256: data.packetFileHash, label_file_sha256: data.labelFileHash,
    retries: "same as pilot runner: no retry; explicit unsupported-format fallback is a separate paced HTTP request" }, null, 2) + "\n");
  await writeFile(`${directory}/inputs.jsonl`, data.packets.map((packet) => canonicalJson({ case_id: packet.case_id, packet_hash: packet.packet_hash, model_inputs: packet.model_inputs })).join("\n") + "\n");
  await writeFile(`${directory}/labels.jsonl`, [...data.labels.values()].map(canonicalJson).join("\n") + "\n");
  const trials: Trial[] = []; let status = "running";
  const stops: Record<string, string | null> = {};
  async function atomic(name: string, text: string) { await writeFile(`${directory}/${name}.tmp`, text); await rename(`${directory}/${name}.tmp`, `${directory}/${name}`); }
  async function checkpoint() {
    await atomic("results.json", JSON.stringify({ state: { ...freeze, status, arms, stops }, trials }, null, 2) + "\n");
    await atomic("gated-results.json", JSON.stringify(gatedMetrics(data.packets, trials, data.labels), null, 2) + "\n");
    const aggregate: SealedEvidence = { ...freeze, status, serv_changes: servChanges(data.packets, trials), unit: "CASE-majority; Wilson 95%; repetitions are not independent", arms: sealedAggregates(data.packets, trials, data.labels, arms) };
    await atomic("aggregate.json", JSON.stringify(aggregate, null, 2) + "\n");
    await atomic("report.md", sealedMarkdown(aggregate));
  }
  await checkpoint();
  try {
    for (const arm of arms) {
      const outcome = await runArm(arm, clients.get(arm)!, data.packets,
        async (trial, attempt, number) => { await writeFile(`${directory}/${arm}-${trial.case_id}-r${trial.repetition}-a${number}.json`, JSON.stringify({ arm, model: MODELS[arm], packet_hash: trial.packet_hash, evidence_hash: trial.evidence_hash, repetition: trial.repetition, attempt_number: number, ...attempt }, null, 2) + "\n"); },
        async (trial) => { trials.push(trial); await checkpoint(); });
      stops[arm] = outcome.stop_reason;
    }
    status = trials.length === data.packets.length * REPETITIONS * arms.length && trials.every((trial) => trial.status === "valid") ? "finished" : "incomplete";
    if (status !== "finished") process.exitCode = 1;
  } catch { status = "failed"; process.exitCode = 1; }
  finally { await checkpoint(); }
  console.log(`Sealed ${status}; saved results and CASE-majority report in ${directory}. Reservation remains consumed.`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/sealed-eval.ts")) {
  main().catch((error: unknown) => {
    // Dataset parsing and provider errors can contain case text. Only the confirmation hint is safe to print.
    console.error(error instanceof Error && (error.message.startsWith("Sealed evaluation requires SEALED_CONFIRM=") || error.message.startsWith("One-shot guard:")) ? error.message : "Sealed evaluation refused or failed. Check credentials, one-shot reservation and private artifacts; no automatic rerun.");
    process.exitCode = 1;
  });
}
