import { evidenceHash } from "../packets/canonical.js";
import type { CasePacket } from "../packets/types.js";
import type { ApiAttempt, Arm, CompletionClient } from "./client.js";
import type { Verdict } from "./schema.js";
import { firstJsonObject, object, validateVerdict } from "./validate.js";

export const REPETITIONS = 3;
export interface Trial {
  arm: Arm;
  case_id: string;
  packet_hash: string;
  evidence_hash?: string;
  repetition: number;
  status: "valid" | "invalid" | "error" | "not_run";
  verdict: Verdict | null;
  claimed_decision: string | null;
  errors: string[];
  attempts: Omit<ApiAttempt, "response_text">[];
}

function content(text: string): string {
  const payload = JSON.parse(text) as unknown;
  const choice = object(payload) && Array.isArray(payload.choices) ? payload.choices[0] as unknown : null;
  const message = object(choice) && object(choice.message) ? choice.message : null;
  if (!message || typeof message.content !== "string" || !message.content.trim()) throw new Error("Missing text in choices[0].message.content.");
  return message.content;
}

export async function runArm(
  arm: Arm,
  client: CompletionClient,
  packets: CasePacket[],
  saveAttempt: (trial: Trial, attempt: ApiAttempt, number: number) => Promise<void>,
  saveTrial: (trial: Trial) => Promise<void>,
): Promise<{ stop_reason: string | null }> {
  let stopReason: string | null = null;
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) for (const packet of packets) {
    const trial: Trial = {
      arm, case_id: packet.case_id, packet_hash: packet.packet_hash, evidence_hash: evidenceHash(packet.model_inputs), repetition,
      status: "not_run", verdict: null, claimed_decision: null, errors: [], attempts: [],
    };
    if (stopReason) {
      trial.errors.push(stopReason);
      await saveTrial(trial);
      continue;
    }
    const completion = await client.complete(packet.model_inputs, (attempt, number) => saveAttempt(trial, attempt, number));
    trial.attempts = completion.attempts.map(({ response_text: _responseText, ...metadata }) => metadata);
    const final = completion.final;
    if (final.network_error || final.http_status === null || final.http_status < 200 || final.http_status >= 300) {
      trial.status = "error";
      trial.errors.push(final.network_error ?? `HTTP ${final.http_status}`);
      if (final.http_status === 402 || final.http_status === 429) stopReason = `${arm} arm stopped on first HTTP ${final.http_status}; no retries, remaining trials not run.`;
      if (final.http_status === 401 || final.http_status === 403) stopReason = `${arm} arm stopped on HTTP ${final.http_status}; check credentials/access.`;
    } else {
      try {
        const parsed = firstJsonObject(content(final.response_text));
        if (object(parsed) && typeof parsed.decision === "string") trial.claimed_decision = parsed.decision;
        const checked = validateVerdict(parsed, packet.model_inputs.rules_text, { requireDecisiveLocal: true });
        trial.verdict = checked.verdict;
        trial.errors = checked.errors;
        trial.status = checked.verdict ? "valid" : "invalid";
      } catch {
        trial.status = "invalid";
        trial.errors.push("Response content is missing, malformed or has no complete first JSON object.");
      }
    }
    await saveTrial(trial);
  }
  return { stop_reason: stopReason };
}
