import { proceedNeeds, describeNeeds } from "./needs.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, inputHash, sha256 } from "../packets/canonical.js";
import { PROCEDURE_SHA256, PROCEDURE_VERSION } from "../judge/prompt.js";
import { reviewPolicy } from "../reppo/policy.js";
import type { ReppoSummary } from "../reppo/policy.js";
import type { LivePacket } from "../demo/live.js";
import type { Verdict } from "../judge/schema.js";
import { GATE_VERSION } from "./decide.js";
import type { GateDecision } from "./decide.js";

export interface Receipt extends GateDecision {
  evidence_hash: string;
  original_gate_decision?: GateDecision;
  held_gate_decision?: GateDecision;
  receipt_id: string; created_at: string; packet_hash: string; case_id: string; market_id: string | null;
  proposal_time_utc: string; model: string; procedure_version: string; procedure_sha256: string;
  gate_version: string; serv_request_id: string | null; serv_verdict: Verdict | null; live_packet?: LivePacket; serv_called?: boolean; receipt_sha256: string; reppo?: ReppoSummary;
}
export function receiptHash(receipt: Omit<Receipt, "receipt_sha256"> | Receipt): string {
  const { receipt_sha256: _ignored, ...body } = receipt as Receipt;
  return sha256(canonicalJson(body));
}
export function cacheKey(packet_hash: string, proposal_time_utc: string, model: string, evidence_hash = inputHash(null)): string {
  return inputHash({ packet_hash, evidence_hash, proposal_time_utc, model, procedure_sha256: PROCEDURE_SHA256, gate_version: GATE_VERSION });
}
export function createReceipt(input: Pick<Receipt, "packet_hash" | "case_id" | "market_id" | "proposal_time_utc" | "model" | "serv_request_id" | "serv_verdict"> & GateDecision & Partial<Pick<Receipt, "live_packet" | "serv_called" | "evidence_hash">>,
  identity = { receipt_id: randomUUID(), created_at: new Date().toISOString() }): Receipt {
  const needs = input.needs ?? proceedNeeds(input);
  const body = { ...input, needs, need_details: describeNeeds(needs, input.earliest_utc), evidence_hash: input.evidence_hash ?? inputHash(input.evidence_as_of_proposal ?? null), ...identity, procedure_version: PROCEDURE_VERSION, procedure_sha256: PROCEDURE_SHA256, gate_version: GATE_VERSION };
  return { ...body, receipt_sha256: receiptHash(body) };
}
const writes = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(key) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation); writes.set(key, task);
  try { return await task; } finally { if (writes.get(key) === task) writes.delete(key); }
}
async function writeReceipt(receipt: Receipt, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${receipt.receipt_id}.json`); const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${canonicalJson(receipt)}\n`, { mode: 0o600 }); await rename(temp, path);
}
export async function persistReceipt(receipt: Receipt, directory = ".cache/receipts"): Promise<void> {
  const path = resolve(directory, `${receipt.receipt_id}.json`);
  await serialized(path, async () => {
    const existing = await readReceipt(receipt.receipt_id, directory);
    // Cached base receipts must never erase a later, paid independent review.
    if (existing?.reppo && (existing.reppo.evaluated_receipt_sha256 === receipt.receipt_sha256 || existing.receipt_sha256 === receipt.receipt_sha256)) return;
    await writeReceipt(receipt, directory);
  });
}
export async function appendReppo(receiptId: string, summary: ReppoSummary, directory = ".cache/receipts"): Promise<Receipt> {
  const path = resolve(directory, `${receiptId}.json`);
  return serialized(path, async () => {
    const receipt = await readReceipt(receiptId, directory);
    if (!receipt) throw new Error("Receipt not found");
    if (receipt.reppo) {
      if (receipt.reppo.eval_id !== summary.eval_id) throw new Error("Receipt already has a different independent review");
      return receipt;
    }
    if (receipt.receipt_sha256 !== summary.evaluated_receipt_sha256) throw new Error("Reviewed receipt changed");
    const originalAction = receipt.action ?? (receipt.final_decision === "SUPPORTED_NOW" ? "PROCEED" : receipt.final_reason === "PREMATURE" ? "WAIT" : "NEED_EVIDENCE");
    const policy = reviewPolicy(receipt.final_decision, summary, originalAction);
    const held: GateDecision = { needs: ["NEED_REVIEW_CLEARANCE"], need_details: describeNeeds(["NEED_REVIEW_CLEARANCE"]), final_decision: policy.final_decision, final_reason: null, action: policy.action, gate: { ...receipt.gate, gate_reason: "held by independent review" } };
    const original: GateDecision = { needs: receipt.needs ?? proceedNeeds(receipt), final_decision: receipt.final_decision, final_reason: receipt.final_reason, action: originalAction, gate: receipt.gate };
    const updated = { ...receipt, reppo: summary, ...(policy.held ? { ...held, original_gate_decision: original, held_gate_decision: held } : {}) };
    updated.receipt_sha256 = receiptHash(updated);
    await writeReceipt(updated, directory); return updated;
  });
}
export async function readReceipt(id: string, directory = ".cache/receipts"): Promise<Receipt | null> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id)) return null;
  try {
    const receipt = JSON.parse(await readFile(resolve(directory, `${id}.json`), "utf8")) as Receipt;
    if (receipt.receipt_id !== id || receiptHash(receipt) !== receipt.receipt_sha256) throw new Error("Receipt integrity failure");
    return receipt;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
