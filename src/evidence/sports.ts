/** Accept ISO source dates/timestamps only; Date.parse alone normalizes impossible dates. */
function sourceTime(value: unknown, allowDate = false): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/u.test(value) || !Number.isFinite(Date.parse(value))) return false;
  if (!allowDate && value.length === 10) return false;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toISOString().slice(0, 10) === value.slice(0, 10);
}
export interface SportsEvidence {
  kind: "sports_feed"; source: "polymarket_gamma_event"; event_id: string; slug: string;
  ended: boolean | null; finished_utc: string | null; score: string | null; period: string | null; fetched_at: string;
}
export function sportsEvidence(event: Record<string, unknown>, fetched_at: string): SportsEvidence | null {
  if (typeof event.ended !== "boolean" && typeof event.finishedTimestamp !== "string") return null;
  if (!sourceTime(fetched_at)) return null;
  const timeKeys = ["finishedTimestamp", "gameStartTime", "startTime", "eventStartTime", "scheduledStartTime", "startDate"];
  for (const key of timeKeys) if (event[key] !== undefined && event[key] !== null &&
    !sourceTime(event[key], key === "startDate")) return null;
  const finished = typeof event.finishedTimestamp === "string" ? new Date(event.finishedTimestamp).toISOString() : null;
  if (finished && (event.ended === false || Date.parse(finished) > Date.parse(fetched_at) || timeKeys.slice(1).some((key) => typeof event[key] === "string" && Date.parse(event[key] as string) > Date.parse(finished)))) return null;
  return { kind: "sports_feed", source: "polymarket_gamma_event", event_id: String(event.id ?? ""), slug: typeof event.slug === "string" ? event.slug : "",
    ended: typeof event.ended === "boolean" ? event.ended : null, finished_utc: finished,
    score: typeof event.score === "string" ? event.score : null, period: typeof event.period === "string" ? event.period : null, fetched_at };
}

/** Explicit in-play periods only; absent, scheduled, final and postponed states abstain. */
export function inPlayPeriod(period: string | null): boolean {
  return typeof period === "string" && /^(?:[1-9]\d*|[1-9](?:st|nd|rd|th)?\s*(?:quarter|period|half|inning|set)|[QHP][1-9]|[1-9][QHP]|top\s*\d+|bottom\s*\d+|OT(?:\d+)?|overtime|HT|halftime|[12]H|in[ -]play|live)$/iu.test(period.trim());
}
