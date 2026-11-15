import { VERDICT_SCHEMA } from "./schema.js";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fetch } from "undici";
import { safeMessage } from "../collect/http.js";
import type { ModelInputs } from "../packets/types.js";
import { SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { object } from "./validate.js";

export const MODEL = "gemini-3.6-flash";
export type Arm = "raw" | "serv";
export const MODELS: Record<Arm, string> = { raw: process.env.RAW_MODEL ?? "google/gemini-3.6-flash", serv: process.env.SERV_MODEL ?? MODEL };
export const MAX_TOKENS = 8_000; // reasoning tokens count toward this cap (2k truncated SERV with finish_reason=length)
export const CALL_INTERVAL_MS: Record<Arm, number> = { raw: 1_500, serv: 2_000 };
export function pilotArms(value: string): Arm[] {
  const requested = value.split(",").map((name) => name.trim()).filter(Boolean);
  if (!requested.length || requested.some((name) => name !== "raw" && name !== "serv")) {
    throw new Error("PILOT_ARMS must select raw, serv, or raw,serv.");
  }
  return (["raw", "serv"] as const).filter((arm) => requested.includes(arm));
}
export interface TokenUsage {
  prompt: number | null; completion: number | null; total: number | null;
  reasoning?: number | null; cost_usd?: number | null;
}
export interface ApiAttempt {
  started_at: string;
  request_format: "json_schema" | "plain" | "json_object"; // json_object only for legacy B2 records/tests.
  http_status: number | null;
  latency_ms: number;
  response_text: string;
  serv_request_id?: string | null;
  network_error: string | null;
  usage: TokenUsage;
}
export interface Completion { attempts: ApiAttempt[]; final: ApiAttempt }
export interface CompletionClient {
  complete(inputs: ModelInputs, save: (attempt: ApiAttempt, number: number) => Promise<void>): Promise<Completion>;
}

export function responseUsage(text: string): TokenUsage {
  let payload: unknown;
  try { payload = JSON.parse(text) as unknown; } catch { payload = null; }
  const usage: Record<string, unknown> = object(payload) && object(payload.usage) ? payload.usage : {};
  function number(key: string): number | null {
    const value = usage[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  const details: Record<string, unknown> = object(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const reasoning = typeof details.reasoning_tokens === "number" && Number.isFinite(details.reasoning_tokens) && details.reasoning_tokens >= 0
    ? details.reasoning_tokens : number("reasoning_tokens");
  const cost = typeof usage.cost === "number" ? usage.cost
    : typeof usage.cost === "string" && usage.cost.trim() ? Number(usage.cost) : NaN;
  return { prompt: number("prompt_tokens"), completion: number("completion_tokens"), total: number("total_tokens"),
    reasoning, cost_usd: Number.isFinite(cost) && cost >= 0 ? cost : null };
}

export function requestBody(arm: Arm, inputs: ModelInputs, format: "json_schema" | "plain"): Record<string, unknown> {
  return {
    model: MODELS[arm], max_tokens: MAX_TOKENS,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMessage(inputs) }],
    ...(format === "json_schema" ? { response_format: {
      type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA },
    } } : {}),
    // Temperature deliberately omitted: provider/model default.
  };
}

function endpoint(base: string): string {
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    if (url.hostname === "polymarket.com" || url.hostname.endsWith(".polymarket.com")) throw new Error();
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/chat/completions`;
    return url.href;
  } catch { throw new Error("Invalid inference base URL: require HTTPS, no credentials/query, and no Polymarket host."); }
}

export class InferenceClient implements CompletionClient {
  private readonly url: string;
  private readonly key: string;
  private readonly intervalMs: number;
  private readonly arm: Arm;
  private lastStartedAt = -Infinity;
  private format: "json_schema" | "plain" = "json_schema";
  private readonly strictOnly: boolean;

  constructor(arm: Arm, options: { strictOnly?: boolean } = {}) {
    const key = process.env[arm === "raw" ? "OPENROUTER_API_KEY" : "SERV_API_KEY"]?.trim();
    const base = arm === "raw" ? "https://openrouter.ai/api/v1" : "https://inference-api.openserv.ai/v1";
    if (!key) throw new Error(`Missing runtime credentials for ${arm}; no requests sent.`);
    this.arm = arm;
    this.strictOnly = options.strictOnly ?? false;
    this.key = key;
    this.url = endpoint(base);
    this.intervalMs = CALL_INTERVAL_MS[arm];
  }

  private async request(inputs: ModelInputs): Promise<ApiAttempt> {
    const wait = this.intervalMs - (performance.now() - this.lastStartedAt);
    if (wait > 0) await delay(wait);
    this.lastStartedAt = performance.now();
    const started = performance.now();
    const startedAt = new Date().toISOString();
    let status: number | null = null;
    try {
      // Inference endpoints are HTTPS, non-Polymarket, and redirects are rejected.
      // This uses undici directly (no environment/global proxy) and no retries.
      const response = await fetch(this.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
        body: JSON.stringify(requestBody(this.arm, inputs, this.format)),
      });
      status = response.status;
      // Redact this client's actual key as well as shared helper redaction.
      const text = safeMessage(new Error((await response.text()).split(this.key).join("[redacted]")));
      return { started_at: startedAt, request_format: this.format, http_status: status, latency_ms: performance.now() - started,
        serv_request_id: response.headers.get("x-openserv-request-id"), response_text: text, network_error: null, usage: responseUsage(text) };
    } catch {
      // Never persist transport exception messages, headers, endpoint URLs or keys.
      return { started_at: startedAt, request_format: this.format, http_status: status, latency_ms: performance.now() - started,
        response_text: "", network_error: "Network error or request timeout (details withheld).",
        usage: { prompt: null, completion: null, total: null, reasoning: null, cost_usd: null } };
    }
  }

  async complete(inputs: ModelInputs, save: (attempt: ApiAttempt, number: number) => Promise<void>): Promise<Completion> {
    const attempts: ApiAttempt[] = [];
    for (let index = 0; index < 2; index += 1) {
      const attempt = await this.request(inputs);
      attempts.push(attempt);
      await save(attempt, index + 1);
      const unsupportedFormat = this.format === "json_schema" && [400, 422].includes(attempt.http_status ?? 0) &&
        /response[_ ]?format|json_schema/iu.test(attempt.response_text) && /not supported|unsupported|unknown|unrecognized|invalid/iu.test(attempt.response_text);
      if (unsupportedFormat && index === 0 && !this.strictOnly) {
        this.format = "plain"; // One explicit format fallback, still rate limited.
        continue;
      }
      // In particular, 402/429 NEVER retry or fall back.
      return { attempts, final: attempt };
    }
    throw new Error("Unreachable response-format fallback state.");
  }
}
