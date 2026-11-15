export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reason", "checks", "decisive_time_utc", "sports", "decisive_local"],
  properties: {
    decision: { type: "string", enum: ["SUPPORTED_NOW", "NOT_SUPPORTED_NOW", "INSUFFICIENT_EVIDENCE"], description: "Must agree with the rest: SUPPORTED_NOW => reason null and timing.status PASS; NOT_SUPPORTED_NOW => reason PREMATURE and timing.status FAIL; INSUFFICIENT_EVIDENCE => reason null and timing.status UNKNOWN." },
    // Keep the narrowed enum used in the strict-schema pilot.
    reason: { type: ["string", "null"], enum: ["PREMATURE", null], description: "PREMATURE when decision is NOT_SUPPORTED_NOW; otherwise null." },
    checks: {
      type: "object", additionalProperties: false, required: ["timing"],
      properties: {
        timing: {
          type: "object", additionalProperties: false,
          required: ["status", "clause_quote", "explanation"],
          properties: {
            status: { type: "string", enum: ["PASS", "FAIL", "UNKNOWN"] },
            clause_quote: { type: "string", minLength: 1, description: "A nonempty substring of rules_text. Only NFKC, curly/straight quote and whitespace normalization are allowed; never paraphrase." },
            explanation: { type: "string", pattern: "^\\s*\\S+(?:\\s+\\S+){0,59}\\s*$", description: "At most 60 whitespace-separated words." },
          },
        },
      },
    },
    sports: { type: ["object", "null"], additionalProperties: false, required: ["league_or_sport", "stated_start_utc", "explicit_end_utc"], properties: {
      league_or_sport: { type: "string" }, stated_start_utc: { type: ["string", "null"], format: "date-time" }, explicit_end_utc: { type: ["string", "null"], format: "date-time" },
    } },
    decisive_local: {
      type: "object", additionalProperties: false, required: ["date", "time", "timezone", "adjust_minutes"],
      properties: {
        date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Governing local date; infer year only from packet context." },
        time: { type: ["string", "null"], pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", description: "Stated wall clock in 24-hour HH:MM; never shift it to UTC." },
        timezone: { type: ["string", "null"], enum: ["ET", "PT", "UTC", "EST", "EDT", "PST", "PDT", null] },
        adjust_minutes: { type: "integer", description: "0 unless the convention requires an adjustment; 1 for a labelled one-minute candle or inclusive 11:59 PM end. With null clock fields, use 0." },
      },
    },
    decisive_time_utc: { type: ["string", "null"], format: "date-time", description: "Evidence timestamp or best-effort UTC estimate. The application computes clock cutoffs from decisive_local." },
  },
} as const;

export interface DecisiveLocal {
  date: string | null;
  time: string | null;
  timezone: "ET" | "PT" | "UTC" | "EST" | "EDT" | "PST" | "PDT" | null;
  adjust_minutes: number;
}

export interface Verdict {
  decision: "SUPPORTED_NOW" | "NOT_SUPPORTED_NOW" | "INSUFFICIENT_EVIDENCE";
  reason: "PREMATURE" | null;
  checks: { timing: { status: "PASS" | "FAIL" | "UNKNOWN"; clause_quote: string; explanation: string } };
  decisive_time_utc: string | null;
  /** Required by timing-v8 schema; optional here only for saved older verdicts. */
  decisive_local?: DecisiveLocal;
  /** Absent only for saved pre-v4 responses, which can still be regated offline. */
  sports?: { league_or_sport: string; stated_start_utc: string | null; explicit_end_utc: string | null } | null;
}
