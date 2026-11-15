import type { DecisiveLocal, Verdict } from "../judge/schema.js";
import { zonedUtc } from "./cutoff.js";

export interface ServTime {
  utc: string | null;
  source: "computed_from_local" | "model_utc" | null;
  model_utc: string | null;
  mismatch_seconds: number | null;
}

/** Impossible dates and DST gaps/folds have no unique computed clock. */
export function localClockUtc(local: DecisiveLocal): string | null {
  if (typeof local.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(local.date) ||
      typeof local.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(local.time) ||
      !["ET", "PT", "UTC", "EST", "EDT", "PST", "PDT"].includes(local.timezone ?? "") || !Number.isSafeInteger(local.adjust_minutes)) return null;
  const [year, month, day] = local.date.split("-").map(Number);
  const [hour, minute] = local.time.split(":").map(Number);
  const base = zonedUtc(year!, month!, day!, hour!, minute!, local.timezone!);
  if (!base) return null;
  const adjusted = new Date(Date.parse(base) + local.adjust_minutes * 60_000);
  return Number.isFinite(adjusted.getTime()) ? adjusted.toISOString() : null;
}

/** The extracted clock is authoritative; legacy and evidence verdicts retain model UTC. */
export function servDecisiveUtc(verdict: Verdict): ServTime {
  const model_utc = verdict.decisive_time_utc;
  const local = verdict.decisive_local;
  if (local && (local.date !== null || local.time !== null || local.timezone !== null || local.adjust_minutes !== 0)) {
    const utc = localClockUtc(local);
    return { utc, source: utc ? "computed_from_local" : null, model_utc,
      mismatch_seconds: utc && model_utc && Number.isFinite(Date.parse(model_utc)) ? Math.abs(Date.parse(utc) - Date.parse(model_utc)) / 1000 : null };
  }
  const utc = model_utc && Number.isFinite(Date.parse(model_utc)) ? model_utc : null;
  return { utc, source: utc ? "model_utc" : null, model_utc, mismatch_seconds: utc ? 0 : null };
}
