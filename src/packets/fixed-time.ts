export type FixedTimeKind = "crypto_candle" | "crypto_instant" | "sports_scheduled" | "observation_window";
export interface FixedTimeMatch { kind: FixedTimeKind; matched_text: string }
export interface FixedTimeSelection { match: FixedTimeMatch | null; exclusion: string | null }

// A discovery screen, not a time parser. Timing signals must be in ancillary
// text (including its title); Gamma fields alone cannot qualify a market.
const CLOCK = /\b(?:(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:am|pm))?|(?:0?[1-9]|1[0-2])\s*(?:am|pm)|noon|midnight)\b/giu;
const ZONE = /\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|GMT(?:[+-]\d{1,2}(?::\d{2})?)?|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|CET|CEST|America\/[A-Za-z_]+)\b/iu;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/iu;
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))\b/iu;
const DEADLINE = /\b(?:by|before|prior to|until|no later than)\s+(?:the\s+)?(?:end\s+of\s+)?(?:\d|January|February|March|April|May|June|July|August|September|October|November|December|Jan\b|Feb\b|Mar\b|Apr\b|Jun\b|Jul\b|Aug\b|Sep\b|Oct\b|Nov\b|Dec\b|noon|midnight)/iu;
const CANDLE = /\b(?:(?:\d+|one|five|fifteen|thirty|sixty)[-\s]*(?:m|min(?:ute)?s?|h|hours?|d|days?)\s*candle(?:stick)?s?|(?:hourly|daily|minute|one-hour|one-minute)\s+candle(?:stick)?s?|candle(?:stick)?\s+(?:close|closing))\b/iu;
const CRYPTO = /\b(?:bitcoin|ethereum|solana|dogecoin|ripple|crypto|btc|eth|sol|xrp|doge|bnb|ada|avax|link)\b/iu;

export const FIXED_TIME_POLICY = {
  version: "fixed-time-v1",
  required: "Ancillary date plus clock/timezone or ISO instant; dated hourly/daily candles can use their stated timezone. Windows need two clock endpoints.",
  allowed: ["crypto price at stated time/candle", "Up or Down dated candles", "sports with explicit scheduled date/time", "between X and Y fixed observation windows"],
  excluded: "YES on a by/before-date proposition; Gamma timestamps alone; date-only deadlines; other event-occurrence markets",
} as const;

function hasClock(text: string): boolean { return [...text.matchAll(CLOCK)].length > 0 || ISO_TIME.test(text); }
function hasTimedZone(text: string): boolean {
  return ISO_TIME.test(text) || [...text.matchAll(CLOCK)].some((match) =>
    ZONE.test(text.slice(Math.max(0, match.index! - 12), match.index! + match[0].length + 24)));
}

export function selectFixedTime(title: string, rules: string, proposedValue: string): FixedTimeSelection {
  const text = rules.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const yesCondition = text.match(/\b(?:resolve\w*\s+(?:to\s+)?["“]?yes["”]?\s+if|yes\s+if)\b.{0,240}/iu)?.[0] ?? "";
  if (proposedValue === "1000000000000000000" && (DEADLINE.test(title) || DEADLINE.test(yesCondition))) {
    return { match: null, exclusion: "yes_by_before_deadline" };
  }
  function accept(kind: FixedTimeKind, matched: string): FixedTimeSelection {
    return { match: { kind, matched_text: Array.from(matched).slice(0, 300).join("") }, exclusion: null };
  }
  const window = text.match(/\bbetween\s+([^.;]{1,240}?)\s+and\s+([^.;]{1,240})/iu);
  if (window && hasClock(window[1]!) && hasClock(window[2]!) &&
      (DATE.test(window[0]) || DATE.test(text)) && (ZONE.test(window[0]) || ISO_TIME.test(window[0]))) {
    return accept("observation_window", window[0]);
  }
  const dated = DATE.test(text);
  const timed = hasTimedZone(text);
  const crypto = CRYPTO.test(title) || /\b(?:bitcoin|ethereum|solana|dogecoin|ripple|cryptocurrency)\b/iu.test(text);
  const upDown = /\bup\s+(?:or|\/)\s+down\b/iu.test(`${title} ${text}`);
  const candle = CANDLE.test(text);
  const periodicCandle = candle && /\b(?:hourly|daily|24[- ]hour|1[- ]day)\b/iu.test(text) && ZONE.test(text);
  if (crypto && dated && ((timed && (upDown || candle)) || periodicCandle)) {
    return accept("crypto_candle", text);
  }
  if (crypto && dated && timed && /\b(?:price|above|below|greater|less|higher|lower|at|exactly)\b/iu.test(text)) {
    return accept("crypto_instant", text);
  }
  const sports = /\b(?:nba|nfl|nhl|mlb|wnba|ncaa|soccer|football|basketball|baseball|hockey|tennis|cricket|rugby|ufc|esports)\b/iu.test(`${title} ${text}`) ||
    (/\b(?:vs\.?|versus)\b/iu.test(title) && /\b(?:game|match|tipoff|kickoff|kick-off)\b/iu.test(text));
  if (sports && dated && timed && /\b(?:scheduled|game|match|tipoff|kickoff|kick-off)\b/iu.test(text)) {
    return accept("sports_scheduled", text.match(/\bscheduled\s+(?:for|to\s+(?:start|begin|be played)).{0,220}/iu)?.[0] ?? text);
  }
  return { match: null, exclusion: "not_fixed_time" };
}
