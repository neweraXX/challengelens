import { sportsTiming } from "../gate/cutoff.js";
import type { ModelInputs } from "../packets/types.js";

export function gammaStart(inputs: ModelInputs): string | null {
  const schedules = [inputs.gamma_scheduling.market, ...inputs.gamma_scheduling.events];
  const times = schedules.flatMap((schedule) => [schedule.gameStartTime, schedule.startTime, schedule.eventStartTime, schedule.scheduledStartTime])
    .filter((time): time is string => Boolean(time) && Number.isFinite(Date.parse(time!)));
  return times.length ? new Date(Math.max(...times.map(Date.parse))).toISOString() : null;
}

/** The gate owns timezone conversion and sports timing. */
export function rulesStart(inputs: ModelInputs): string | null { return sportsTiming(inputs).rules_start_utc; }

/** Extract the stated clock, independently of SERV's candle/window end.
 * Unsupported wording stays absent rather than substituting a listing date.
 */
export function rulesObservationTime(inputs: ModelInputs, kind: string): string | null {
  if (kind === "sports_scheduled") return rulesStart(inputs);
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  const datePattern = new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, "iu");
  const date = inputs.title.match(datePattern) ?? inputs.rules_text.match(datePattern);
  if (!date) return null;
  const text = kind === "observation_window" ? inputs.rules_text.match(/\bbetween\s+[^.;]{1,250}/iu)?.[0] ?? "" : inputs.title;
  const clock = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(ET|UTC)\b/iu)
    ?? (kind.startsWith("crypto_") ? inputs.rules_text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:in the\s+)?(ET|UTC)\b/iu) : null);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const suffix = clock[3] ?? (hour < 12 ? "AM" : "PM");
  const meridiemHour = hour % 12 || 12;
  const year = date[3] ?? String(new Date(inputs.proposal_time_utc).getUTCFullYear());
  // Use the same timezone conversion as a stated sports clock. This
  // temporary string is local parsing input; it is never sent to SERV.
  return rulesStart({ ...inputs, rules_text: `scheduled for ${date[1]} ${date[2]}, ${year} at ${meridiemHour}:${clock[2] ?? "00"}${suffix} ${clock[4]}` });
}

export function sportsEstimate(inputs: ModelInputs, _cutoff: string | null): string {
  const timing = sportsTiming(inputs);
  return timing.duration_hours === null ? "estimated game end unavailable" : `estimated: ${timing.sport} +${timing.duration_hours}h`;
}
