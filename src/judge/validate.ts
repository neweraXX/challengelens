import { localClockUtc } from "../gate/serv-time.js";
import type { DecisiveLocal, Verdict } from "./schema.js";

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function validUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && (date.toISOString() === value || date.toISOString().replace(".000Z", "Z") === value);
}

// Typography only: preserve case, words, numbers and all other punctuation.
export function normalizeQuote(text: string): string {
  return text.normalize("NFKC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, " ").trim();
}

export function quoteIsSubstring(quote: string, rules: string): boolean {
  const normalized = normalizeQuote(quote);
  return normalized.length > 0 && normalizeQuote(rules).includes(normalized);
}

export function firstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed) as unknown; } catch { /* Allow fences/preface; parse the first balanced object only. */ }
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object in model content.");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, index + 1)) as unknown; }
      catch { throw new Error("First JSON object is malformed."); }
    }
  }
  throw new Error("First JSON object is incomplete.");
}

// This explicit validator mirrors every schema field and adds v1 consistency,
// typography-normalized substring matching and a word limit. No extra dependency.
export function validateVerdict(value: unknown, rules: string, options: { requireDecisiveLocal?: boolean } = {}): { verdict: Verdict | null; errors: string[] } {
  const errors: string[] = [];
  if (!object(value)) return { verdict: null, errors: ["Verdict must be a closed object."] };
  const expected = ["decision", "reason", "checks", "decisive_time_utc",
    ...(options.requireDecisiveLocal || Object.hasOwn(value, "sports") ? ["sports"] : []),
    ...(options.requireDecisiveLocal || Object.hasOwn(value, "decisive_local") ? ["decisive_local"] : [])];
  if (!exactKeys(value, expected)) return { verdict: null, errors: ["Verdict must contain exactly the required fields (including decisive_local for timing-v8)."] };
  if (Object.hasOwn(value, "decisive_local")) {
    const local = value.decisive_local;
    if (!object(local) || !exactKeys(local, ["date", "time", "timezone", "adjust_minutes"]) ||
        !Number.isSafeInteger(local.adjust_minutes) || !(local.date === null && local.time === null && local.timezone === null && local.adjust_minutes === 0 ||
          localClockUtc(local as unknown as DecisiveLocal) !== null)) errors.push("Invalid decisive_local: use a complete, valid local clock or null date/time/timezone with adjustment 0.");
  }
  if (value.sports !== undefined && value.sports !== null && (!object(value.sports) ||
      !exactKeys(value.sports, ["league_or_sport", "stated_start_utc", "explicit_end_utc"]) || typeof value.sports.league_or_sport !== "string" ||
      value.sports.stated_start_utc !== null && !validUtc(value.sports.stated_start_utc) || value.sports.explicit_end_utc !== null && !validUtc(value.sports.explicit_end_utc))) errors.push("Invalid sports metadata.");
  if (typeof value.decision !== "string" || !["SUPPORTED_NOW", "NOT_SUPPORTED_NOW", "INSUFFICIENT_EVIDENCE"].includes(value.decision)) errors.push("Invalid decision.");
  if (value.reason !== null && value.reason !== "PREMATURE") errors.push("v1 reason must be PREMATURE or null.");
  if (value.decisive_time_utc !== null && !validUtc(value.decisive_time_utc)) errors.push("decisive_time_utc must be a valid UTC timestamp or null.");
  if (!object(value.checks) || !exactKeys(value.checks, ["timing"]) || !object(value.checks.timing) ||
      !exactKeys(value.checks.timing, ["status", "clause_quote", "explanation"])) {
    errors.push("checks must contain only a closed timing object with all three required fields.");
  } else {
    const timing = value.checks.timing;
    if (typeof timing.status !== "string" || !["PASS", "FAIL", "UNKNOWN"].includes(timing.status)) errors.push("Invalid timing status.");
    if (typeof timing.clause_quote !== "string" || !quoteIsSubstring(timing.clause_quote, rules)) {
      errors.push("clause_quote must be a nonempty substring of rules_text after typography normalization.");
    }
    if (typeof timing.explanation !== "string" || !timing.explanation.trim() || timing.explanation.trim().split(/\s+/u).length > 60) {
      errors.push("explanation must contain 1 to 60 words.");
    }
    const expected = timing.status === "PASS" ? ["SUPPORTED_NOW", null]
      : timing.status === "FAIL" ? ["NOT_SUPPORTED_NOW", "PREMATURE"] : ["INSUFFICIENT_EVIDENCE", null];
    if (value.decision !== expected[0] || value.reason !== expected[1]) errors.push("Decision/reason/timing status are inconsistent.");
  }
  return { verdict: errors.length ? null : value as unknown as Verdict, errors };
}
