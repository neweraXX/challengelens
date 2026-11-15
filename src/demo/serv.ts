import { InferenceClient } from "../judge/client.js";
import type { ApiAttempt } from "../judge/client.js";
import { PROCEDURE_VERSION } from "../judge/prompt.js";
import type { Verdict } from "../judge/schema.js";
import type { ModelInputs } from "../packets/types.js";
import { validateVerdict } from "../judge/validate.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Accept legacy saved verdicts for offline regating; validate all present fields. */
export function validateDemoVerdict(value: unknown, rules: string): Verdict {
  let checked = validateVerdict(value, rules);
  // SERV sometimes formats the auxiliary sports timestamps loosely (offsets, missing seconds). They are
  // descriptive only: the gate uses the schedule and the evidence, never these fields. Drop them rather
  // than fail the whole check; every decision-relevant field is still validated strictly.
  if (!checked.verdict && checked.errors.length === 1 && checked.errors[0] === "Invalid sports metadata." && value && typeof value === "object") {
    const sports = (value as { sports?: unknown }).sports;
    const league = sports && typeof sports === "object" && typeof (sports as { league_or_sport?: unknown }).league_or_sport === "string" ? (sports as { league_or_sport: string }).league_or_sport : "unknown";
    checked = validateVerdict({ ...(value as object), sports: { league_or_sport: league, stated_start_utc: null, explicit_end_utc: null } }, rules);
  }
  if (!checked.verdict) throw new Error("Invalid SERV verdict: " + checked.errors.join("; "));
  return checked.verdict;
}

// One shared client per process. It sends the current timing prompt,
// VERDICT_SCHEMA (strict json_schema), and the client's 8000 token cap.
let client: InferenceClient | null = null;
export async function checkWithServ(inputs: ModelInputs, save: (attempt: ApiAttempt) => Promise<void> = async () => {}): Promise<Verdict> {
  if (!PROCEDURE_VERSION.startsWith("timing-v")) throw new Error("Demo requires a timing procedure");
  client ??= new InferenceClient("serv", { strictOnly: true });
  const { final } = await client.complete(inputs, save);
  return verdictFromAttempt(final, inputs.rules_text);
}

export function verdictFromAttempt(final: ApiAttempt, rules: string): Verdict {
  if (final.http_status !== 200 || final.request_format !== "json_schema") throw new Error("SERV check failed");
  const envelope: unknown = JSON.parse(final.response_text);
  if (!record(envelope) || !Array.isArray(envelope.choices)) throw new Error("Invalid SERV envelope");
  const choice: unknown = envelope.choices[0];
  if (!record(choice) || choice.finish_reason !== "stop" || !record(choice.message) || typeof choice.message.content !== "string") {
    throw new Error("SERV returned an incomplete verdict");
  }
  return validateDemoVerdict(JSON.parse(choice.message.content), rules);
}
