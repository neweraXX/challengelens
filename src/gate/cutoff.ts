import { parsePriceWindow } from "../evidence/price.js";
import type { ModelInputs } from "../packets/types.js";

export type CutoffInputs = Pick<ModelInputs, "title" | "rules_text" | "gamma_scheduling" | "proposed_value">;
export interface Cutoff {
  template: "crypto_candle_1m" | "crypto_candle_interval" | "crypto_instant" | "observation_window";
  cutoff_utc: string;
  matched_text: string;
  notes: string[];
}
const MONTHS = "January February March April May June July August September October November December".split(" ");
const DATE = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b|\b(20\d{2})-(\d{2})-(\d{2})\b/giu;
const CLOCK = /\b(\d{1,2})(?::(\d{2}))\s*(AM|PM)?\b|\b(\d{1,2})\s*(AM|PM)\b/giu;
const ZONE = /\b(ET|PT|EST|EDT|PST|PDT|UTC|GMT)\b|America\/(New_York|Los_Angeles)/giu;

/** Round-trip all possible offsets: nonexistent and repeated local minutes abstain. */
export function zonedUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): string | null {
  if (![year, month, day, hour, minute].every(Number.isInteger) || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  const fixed: Record<string, number> = { UTC: 0, GMT: 0, EST: -300, EDT: -240, PST: -480, PDT: -420 };
  if (Object.hasOwn(fixed, zone)) return new Date(wall - fixed[zone]! * 60_000).toISOString();
  const timeZone = zone === "ET" || zone === "America/New_York" ? "America/New_York" : zone === "PT" || zone === "America/Los_Angeles" ? "America/Los_Angeles" : null;
  if (!timeZone) return null;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function parts(time: number): number[] {
    const p = formatter.formatToParts(time);
    return ["year", "month", "day", "hour", "minute"].map((key) => Number(p.find((part) => part.type === key)?.value));
  }
  const offsets = new Set([-36, 0, 36].map((h) => {
    const t = wall + h * 3_600_000;
    const p = parts(t);
    return Date.UTC(p[0]!, p[1]! - 1, p[2]!, p[3]!, p[4]!) - t;
  }));
  const matches = [...offsets].map((offset) => wall - offset).filter((time) => JSON.stringify(parts(time)) === JSON.stringify([year, month, day, hour, minute]));
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
}
function schedules(inputs: CutoffInputs) { return [inputs.gamma_scheduling.market, ...inputs.gamma_scheduling.events]; }
function inferredYear(inputs: CutoffInputs): number | null {
  const text = `${inputs.title} ${inputs.rules_text}`;
  const explicit = [...text.matchAll(DATE)].flatMap((m) => m[3] ?? m[4] ? [Number(m[3] ?? m[4])] : []);
  explicit.push(...[...text.matchAll(/\b(?:in|for|year|of)\s+(20\d{2})\b/giu)].map((m) => Number(m[1])));
  const years = new Set(explicit.length ? explicit : schedules(inputs).flatMap((s) => Object.entries(s)
    .filter(([key]) => /^(?:endDate|startDate|endDateIso|startDateIso|gameStartTime|startTime)$/u.test(key)).map(([, value]) => value.match(/^(20\d{2})-\d{2}-\d{2}/u)?.[1]).filter(Boolean).map(Number)));
  return years.size === 1 ? [...years][0]! : null;
}
export function statedTime(text: string, inputs: CutoffInputs): string | null {
  const iso = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/gu)];
  if (iso.length) {
    if (iso.length !== 1 || [...text.matchAll(DATE)].length !== 1) return null;
    const stamp = iso[0]![0]; const d = stamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u)!;
    if (!zonedUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5]), "UTC") || Number(d[6] ?? 0) > 59 || !Number.isFinite(Date.parse(stamp))) return null;
    return new Date(stamp).toISOString();
  }
  const dates = [...text.matchAll(DATE)];
  const clocks = [...text.matchAll(CLOCK)].filter((m) => !/\d{4}-\d{2}-\d{2}T$/u.test(text.slice(0, m.index)));
  const zones = [...text.matchAll(ZONE)].map((m) => m[0]);
  if (dates.length !== 1 || clocks.length !== 1 || new Set(zones).size !== 1) return null;
  const date = dates[0]!; const clock = clocks[0]!;
  const year = Number(date[3] ?? date[4] ?? inferredYear(inputs));
  const month = date[4] ? Number(date[5]) : MONTHS.findIndex((m) => m.toLowerCase().startsWith(date[1]!.slice(0, 3).toLowerCase())) + 1;
  const day = Number(date[4] ? date[6] : date[2]);
  const suffix = (clock[3] ?? clock[5])?.toUpperCase();
  const h = Number(clock[1] ?? clock[4]);
  if (!year || (suffix && (h < 1 || h > 12))) return null;
  const hour = suffix ? h % 12 + (suffix === "PM" ? 12 : 0) : h;
  return zonedUtc(year, month, day, hour, Number(clock[2] ?? 0), zones[0]!);
}
/** Join one title date with one rules clock; never choose among alternatives. */
function observationText(inputs: CutoffInputs, text: string): string | null {
  const dates = [...text.matchAll(DATE)];
  if (dates.length) return text;
  const titleDates = [...inputs.title.matchAll(DATE)];
  const clocks = [...text.matchAll(CLOCK)];
  if (titleDates.length !== 1 || clocks.length !== 1) return null;
  const zones = [...text.matchAll(ZONE)].map((m) => m[0]);
  if (new Set(zones).size !== 1) return null;
  // A numeric 12:00 is the 24-hour noon clock. Reject contradictory annotations.
  if (/\bnoon\b/iu.test(text) && !/^12:00(?:\s*PM)?$/iu.test(clocks[0]![0].trim())) return null;
  if (/\bmidnight\b/iu.test(text)) return null;
  return `${titleDates[0]![0]} ${clocks[0]![0]} ${zones[0]}`;
}
function singleTime(inputs: CutoffInputs, text: string): string | null {
  const titleTime = statedTime(inputs.title, inputs);
  const combined = observationText(inputs, text);
  const ruleTime = combined ? statedTime(combined, inputs) : null;
  if (titleTime && ruleTime && titleTime !== ruleTime) return null;
  if (ruleTime) return ruleTime;
  if (!/\btitle\b/iu.test(text) || [...text.matchAll(DATE)].length || [...text.matchAll(CLOCK)].length) return null;
  return titleTime;
}
const CRYPTO = /\b(?:Binance|bitcoin|ethereum|solana|BTC|ETH|SOL|XRP|DOGE|crypto)\b/iu;
const SPORTS = /\b(?:NBA|WNBA|NFL|NCAA|MLB|NHL|basketball|baseball|football|soccer|hockey|tennis|cricket|rugby|UFC|esports)\b/iu;
export function isSports(inputs: CutoffInputs): boolean {
  return Boolean(inputs.gamma_scheduling.market.sportsMarketType) || SPORTS.test(`${inputs.title} ${inputs.rules_text}`) || /\bvs\.?\s/iu.test(inputs.title) && /\b(?:game|match)\b/iu.test(inputs.rules_text);
}
export function cutoff(inputs: CutoffInputs): Cutoff | null {
  const normalized = inputs.rules_text.normalize("NFKC");
  const title = inputs.title.normalize("NFKC");
  // Live packets prepend the question. Do not mistake that date-only question
  // for the governing price clause when the description supplies its clock.
  const rules = normalized.startsWith(`${title}\n`) ? normalized.slice(title.length).trim() : normalized;
  if (isSports(inputs)) return null;
  // Unvetted delay/alternate-close conventions must never get the independent key.
  if (/\b(?:publication delay|published after|minutes? after|hours? after|alternative convention|excluding|business days?)\b/iu.test(rules)) return null;
  const result = (template: Cutoff["template"], time: string | null, matched_text: string, notes: string[] = []): Cutoff | null => time ? { template, cutoff_utc: time, matched_text, notes } : null;
  const priceWindow = parsePriceWindow(inputs);
  if (priceWindow) return inputs.proposed_value === "0"
    ? result("observation_window", priceWindow.window_end_utc, rules, ["NOT-reached side: the complete price observation window must end."])
    : null; // Reached side always requires occurrence evidence.
  const window = rules.match(/\bbetween\s+([^.;]{1,220}?)\s*,?\s+and\s+([^.;]{1,220}?)(?=\.(?:\s|$)|\n|$)/iu);
  if (window) {
    const a = statedTime(window[1]!, inputs); const b = statedTime(window[2]!, inputs);
    if (!a || !b || Date.parse(b) <= Date.parse(a)) return null;
    const inclusive = /\b11:59\s*PM\b/iu.test(window[2]!);
    return result("observation_window", new Date(Date.parse(b) + (inclusive ? 60_000 : 0)).toISOString(), window[0], inclusive ? ["Inclusive 11:59 PM end: add one minute."] : []);
  }
  if (!CRYPTO.test(`${inputs.title} ${rules}`)) return null;
  const one = rules.match(/\bBinance\s+1[- ]minute\s+candle\b[^.;\n]{0,240}/iu);
  if (one && [...one[0].matchAll(ZONE)].length) {
    if (/\b(?:close time|label convention)\b/iu.test(rules)) return null;
    const start = singleTime(inputs, one[0]);
    // "closing at 12:00" names the close itself (real Polymarket wording); otherwise the labelled minute closes one minute later.
    if (/\b(?:closes?|closing)\s+at\b/iu.test(one[0])) return result("crypto_candle_1m", start, one[0], ["Rules name the candle close time directly."]);
    return result("crypto_candle_1m", start && new Date(Date.parse(start) + 60_000).toISOString(), one[0], ["Labelled minute +1 minute; candle close."]);
  }
  if (/\bUp\s+(?:or|\/)\s+Down\b/iu.test(inputs.title) && /\b(?:hourly|daily|1[- ]hour|24[- ]hour|1[- ]day)\s+candle\b/iu.test(rules) && /\b(?:begins?|starts?|opening|open)\b/iu.test(rules)) {
    const daily = /\b(?:daily|24[- ]hour|1[- ]day)\s+candle\b/iu.test(rules);
    if (daily && /\b(?:hourly|1[- ]hour)\s+candle\b/iu.test(rules)) return null;
    const start = singleTime(inputs, rules);
    if (!start) return null;

    if (!daily) return result("crypto_candle_interval", new Date(Date.parse(start) + 3_600_000).toISOString(), rules, ["Hourly candle: start +1 hour."]);
    // A daily candle ends at the same LOCAL clock the following day, across DST.
    const wallText = observationText(inputs, rules) ?? inputs.title;
    const date = [...wallText.matchAll(DATE)][0]; const clock = [...wallText.matchAll(CLOCK)][0]; const zone = [...wallText.matchAll(ZONE)].map((m) => m[0]);
    if (!date || !clock || new Set(zone).size !== 1) return null;
    const year = Number(date[3] ?? date[4] ?? inferredYear(inputs));
    const month = date[4] ? Number(date[5]) : MONTHS.findIndex((m) => m.toLowerCase().startsWith(date[1]!.slice(0, 3).toLowerCase())) + 1;
    const next = new Date(Date.UTC(year, month - 1, Number(date[4] ? date[6] : date[2]) + 1));
    const suffix = (clock[3] ?? clock[5])?.toUpperCase(); const h = Number(clock[1] ?? clock[4]);
    return result("crypto_candle_interval", zonedUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), suffix ? h % 12 + (suffix === "PM" ? 12 : 0) : h, Number(clock[2] ?? 0), zone[0]!), rules, ["Daily candle: next local day at the opening clock."]);
  }
  if (/\bcandle|\bbetween|\b(?:by|before|until)\b/iu.test(`${inputs.title} ${rules}`)) return null;
  const instant = rules.match(/\b(?:price|priced)\b[^.;\n]{0,240}/iu);
  if (instant && /\b(?:at|on|as of)\b/iu.test(instant[0])) return result("crypto_instant", singleTime(inputs, instant[0]), instant[0]);
  return null;
}

/** One duration table; estimates never certify game completion. */
export const SPORTS_HOURS: Readonly<Record<string, number>> = { basketball: 4, football: 5, soccer: 3, soccer_extra_time: 4, baseball: 6, hockey: 4, tennis: 8, T20: 6, ODI: 12, Test: 144 };
export interface SportsTiming { start_utc: string | null; rules_start_utc: string | null; gamma_start_utc: string | null; estimated_end_utc: string | null; duration_hours: number | null; sport: string | null; explicit_end_utc: string | null }
export function sportsStart(inputs: CutoffInputs): string | null {
  return sportsTiming(inputs).start_utc;
}
export function sportsTiming(inputs: CutoffInputs): SportsTiming {
  const text = `${inputs.title} ${inputs.rules_text}`;
  const ruleClause = inputs.rules_text.match(/\bscheduled\s+(?:for|to (?:start|begin)(?: on)?)\s+[^.;\n]{1,160}/iu)?.[0];
  const rules = ruleClause ? statedTime(ruleClause, inputs) : null;
  const gamma = schedules(inputs).flatMap((s) => [s.gameStartTime, s.startTime, s.eventStartTime, s.scheduledStartTime]).filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)));
  const gammaStart = gamma.length ? new Date(Math.max(...gamma.map(Date.parse))).toISOString() : null;
  const starts = [rules, gammaStart].filter((t): t is string => t !== null);
  const start = starts.length ? new Date(Math.max(...starts.map(Date.parse))).toISOString() : null;
  const sport = /\b(?:NBA|WNBA|basketball)\b/iu.test(text) ? "basketball" : /\b(?:NFL|college football|NCAA football)\b/iu.test(text) ? "football"
    : /\bsoccer\b/iu.test(text) ? /extra time|penalt/iu.test(text) ? "soccer_extra_time" : "soccer" : /\b(?:MLB|baseball)\b/iu.test(text) ? "baseball"
    : /\b(?:NHL|hockey)\b/iu.test(text) ? "hockey" : /\btennis\b/iu.test(text) ? "tennis" : /\bcricket\b/iu.test(text) ? /\bT20\b/iu.test(text) ? "T20" : /\bODI\b/iu.test(text) ? "ODI" : /\bTest\b/u.test(text) ? "Test" : null : null;
  const hours = sport ? SPORTS_HOURS[sport] ?? null : null;
  const endClause = inputs.rules_text.match(/\b(?:ends? at|ends? on|explicit end)\s+[^.;\n]{1,140}/iu)?.[0];
  return { start_utc: start, rules_start_utc: rules, gamma_start_utc: gammaStart, estimated_end_utc: start && hours !== null ? new Date(Date.parse(start) + hours * 3_600_000).toISOString() : null, duration_hours: hours, sport, explicit_end_utc: endClause ? statedTime(endClause, inputs) : null };
}
