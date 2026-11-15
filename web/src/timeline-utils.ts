const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export interface AxisTick { time: number; label: string }

/** At most six minute-aligned ticks; dates appear only at a day change. */
export function axisTicks(start: number, end: number, requested = 5): AxisTick[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const count = Math.max(2, Math.min(6, Math.floor(requested) || 5));
  const first = Math.ceil(start / MINUTE) * MINUTE;
  const last = Math.floor(end / MINUTE) * MINUTE;
  if (first > last) return [];
  const times = [...new Set(Array.from({ length: count }, (_, index) =>
    Math.round((first + (last - first) * index / (count - 1)) / MINUTE) * MINUTE))];
  let previousDay = "";
  return times.map((time) => {
    const day = new Date(time).toISOString().slice(0, 10);
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
    const date = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "numeric", day: "numeric" }).format(time);
    const label = day === previousDay ? clock : `${date} ${clock}`;
    previousDay = day;
    return { time, label };
  });
}

/** Reveal must not stretch the scale to a much later settlement. */
export function timelineDomain(values: (number | null)[]): [number, number] {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return [Math.min(...valid) - HOUR, Math.max(...valid) + HOUR];
}

export function durationText(milliseconds: number): string {
  const minutes = Math.round(Math.abs(milliseconds) / MINUTE);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ""}` : `${minutes}m`;
}

export interface RescheduleFacts {
  rules_time_utc: string | null;
  gamma_time_utc: string | null;
  proposal_time_utc: string;
  decisive_time_utc: string | null;
  sports: boolean;
  rules_text: string;
}
function easternClock(time: number, reference?: number): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const crossesDate = reference !== undefined && day.format(time) !== day.format(reference);
  const date = crossesDate ? `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(time)}, ` : "";
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(time).replace(/\s+/gu, " ");
  return `${date}${clock} ET`;
}

/** The text-only cutoff is a counterfactual using the gate's duration. */
export function rescheduleCallout(facts: RescheduleFacts): string | null {
  if (!facts.rules_time_utc || !facts.gamma_time_utc) return null;
  const rules = Date.parse(facts.rules_time_utc);
  const gamma = Date.parse(facts.gamma_time_utc);
  const proposal = Date.parse(facts.proposal_time_utc);
  if (![rules, gamma, proposal].every(Number.isFinite) || rules === gamma) return null;
  const event = !facts.sports ? "observation" : /\bMLB\b/iu.test(facts.rules_text) ? "first pitch"
    : /\b(?:NBA|WNBA)\b/iu.test(facts.rules_text) ? "tip-off" : "event start";
  let text = `Rules text: ${event} at ${easternClock(rules)}.`;
  const cutoff = facts.decisive_time_utc ? Date.parse(facts.decisive_time_utc) : NaN;
  if (facts.sports && gamma > rules && Number.isFinite(cutoff) && cutoff > gamma) {
    text = `Rules text: ${event} at ${easternClock(rules)} → using the gate’s duration estimate, the text-only estimated end is ~${easternClock(rules + cutoff - gamma, rules)}.`;
  }
  text += ` Polymarket moved ${event} to ${easternClock(gamma, rules)} (${gamma > rules ? "+" : "−"}${durationText(gamma - rules)}).`;
  text += proposal === gamma ? " The proposal came at the scheduled start."
    : ` The proposal came ${durationText(proposal - gamma)} ${proposal < gamma ? "before" : "after"} the rescheduled ${event}.`;
  return text;
}

export function readableExplanation(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\b/gu, (iso) => {
    if (!Number.isFinite(Date.parse(iso))) return iso;
    return `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))} UTC`;
  });
}
