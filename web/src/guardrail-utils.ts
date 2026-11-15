import type { SealedEvidence } from "../../src/demo/types.js";

export interface GuardrailCounts { total: number; aloneApproved: number; checkedApproved: number; intervalHigh: number }
export function guardrailCounts(runs: readonly SealedEvidence[]): GuardrailCounts | null {
  const newest = runs.filter((run) => run.blind === true && Number.isFinite(Date.parse(run.date)))
    .reduce<SealedEvidence | null>((latest, run) => !latest || Date.parse(run.date) > Date.parse(latest.date) ? run : latest, null);
  const alone = newest?.arms.find((arm) => arm.arm === "serv")?.false_approvals;
  const checked = newest?.arms.find((arm) => arm.arm === "serv+gate")?.false_approvals;
  if (!alone || !checked || alone.total !== checked.total || !Number.isSafeInteger(alone.total) || alone.total <= 0) return null;
  if (![alone.count, checked.count].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= alone.total)) return null;
  if (checked.high === null || !Number.isFinite(checked.high) || checked.high < 0 || checked.high > 1) return null;
  return { total: alone.total, aloneApproved: alone.count, checkedApproved: checked.count, intervalHigh: checked.high };
}

/** 60 ms per tile for the current run; compress only oversized future runs to stay under four seconds. */
export function guardrailSchedule(total: number) {
  const size = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const staggerMs = size > 1 ? Math.min(60, 1800 / (size - 1)) : 60;
  const entryEnd = size ? (size - 1) * staggerMs + 180 : 0;
  return { staggerMs, entryEnd, stampEnd: entryEnd + 700, checkStart: entryEnd + 950, checkEnd: entryEnd + 1800, duration: entryEnd + 1960 };
}

export function guardrailFrame(counts: GuardrailCounts, elapsedMs: number) {
  const schedule = guardrailSchedule(counts.total);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const checking = elapsed >= schedule.checkStart;
  const progress = clamp((elapsed - schedule.checkStart) / (schedule.checkEnd - schedule.checkStart));
  const approved = checking ? Math.round(counts.aloneApproved + (counts.checkedApproved - counts.aloneApproved) * progress)
    : Math.round(counts.aloneApproved * clamp((elapsed - schedule.entryEnd) / (schedule.stampEnd - schedule.entryEnd)));
  return { approved, checking, gateProgress: progress, done: elapsed >= schedule.duration };
}
