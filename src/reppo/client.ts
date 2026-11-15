import { fetch } from "undici";
import { setTimeout as sleep } from "node:timers/promises";

export type ReppoStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type ReppoRoute = "ship" | "review" | "block";
export type ReppoDecision = "accept" | "reject";
export type ReppoConfidence = "low" | "medium" | "high";
export interface ReppoResult { decision: ReppoDecision; confidence: ReppoConfidence; reason: string; rubric_scores: unknown; consensus: unknown; explain: unknown }
export interface ReppoEvaluation {
  id: string; status: ReppoStatus; score?: number; route?: ReppoRoute; result?: ReppoResult; trace?: unknown; creditsCharged?: number;
  [key: string]: unknown;
}
export const MAX_INPUT_BYTES = 50_000;
export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 180_000;
export class ReppoError extends Error {
  constructor(message: string, readonly status = 502, readonly notQueued = false, readonly retryAfter = 0) { super(message); }
}
export function validEvalId(id: string): boolean { return /^[A-Za-z0-9_-]{1,160}$/u.test(id); }
function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
export function parseEvaluation(value: unknown): ReppoEvaluation {
  if (!record(value) || typeof value.id !== "string" || !validEvalId(value.id) || !["QUEUED", "PROCESSING", "COMPLETED", "FAILED"].includes(String(value.status))) throw new ReppoError("Reppo returned an invalid evaluation response.");
  if (value.status === "COMPLETED") {
    const r = value.result;
    if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 || !["ship", "review", "block"].includes(String(value.route)) || !record(r) || !["accept", "reject"].includes(String(r.decision)) || !["low", "medium", "high"].includes(String(r.confidence)) || typeof r.reason !== "string") throw new ReppoError("Reppo returned an invalid completed result.");
  }
  return value as unknown as ReppoEvaluation;
}
type Transport = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: "error" }) => Promise<{ status: number; text(): Promise<string> }>;
export class ReppoClient {
  private readonly key: string;
  constructor(private readonly options: { transport?: Transport; now?: () => number; wait?: (ms: number) => Promise<unknown> } = {}) {
    this.key = process.env.REPPO_API_KEY?.trim() ?? "";
    if (!this.key) throw new ReppoError("REPPO_API_KEY is not configured.", 503, true);
  }
  private async request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<ReppoEvaluation> {
    let response;
    try {
      response = await (this.options.transport ?? fetch)(`https://eval.reppo.xyz/api/v1/agents/evals${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
        headers: { authorization: `Bearer ${this.key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new ReppoError(method === "POST" ? "Reppo submission outcome is unknown; it will not be submitted again automatically." : "Reppo status request failed."); }
    if (response.status !== (method === "POST" ? 201 : 200)) {
      const messages: Record<number, string> = { 400: "Reppo rejected the evaluation input.", 401: "Reppo credentials were rejected.", 402: "Reppo has insufficient credits.", 502: "Reppo did not queue the evaluation; no credits were charged." };
      throw new ReppoError(messages[response.status] ?? "Reppo request failed.", response.status === 401 || response.status === 402 ? 503 : 502,
        method === "POST" && [400, 401, 402, 502].includes(response.status));
    }
    try { return parseEvaluation(JSON.parse(await response.text())); }
    catch { throw new ReppoError("Reppo returned an unreadable response; no automatic resubmission will occur."); }
  }
  async submit(input: string): Promise<ReppoEvaluation> {
    if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) throw new ReppoError("Reppo input exceeds the 50 KB cap.", 400, true);
    return this.request("POST", "", { taskType: "response", input });
  }
  async get(id: string, timeoutMs = 30_000): Promise<ReppoEvaluation> {
    if (!validEvalId(id)) throw new ReppoError("Invalid evaluation ID.", 400);
    const result = await this.request("GET", `/${encodeURIComponent(id)}`, undefined, timeoutMs);
    if (result.id !== id) throw new ReppoError("Reppo returned a different evaluation ID.");
    return result;
  }
  async poll(id: string, update: (result: ReppoEvaluation) => Promise<void> = async () => {}, timeoutMs = POLL_TIMEOUT_MS): Promise<ReppoEvaluation> {
    const now = this.options.now ?? Date.now; const deadline = now() + Math.min(timeoutMs, POLL_TIMEOUT_MS);
    while (now() < deadline) {
      await (this.options.wait ?? sleep)(Math.min(POLL_INTERVAL_MS, deadline - now()));
      if (now() >= deadline) break;
      let result: ReppoEvaluation;
      try { result = await this.get(id, Math.min(30_000, deadline - now())); }
      catch (error) { if (error instanceof ReppoError && error.status === 502) continue; throw error; }
      await update(result);
      if (result.status === "COMPLETED" || result.status === "FAILED") return result;
    }
    throw new ReppoError("Reppo polling timed out after 180 seconds; the evaluation ID remains valid.", 504);
  }
}
