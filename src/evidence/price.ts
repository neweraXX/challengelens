import type { ModelInputs } from "../packets/types.js";
import { statedTime, zonedUtc } from "../gate/cutoff.js";

export interface PriceWindow { symbol: string; target: number; direction: "high" | "low"; window_start_utc: string; window_end_utc: string; final_high_low?: boolean }
export interface PriceEvidence {
  kind: "price_touch"; source: "binance_klines_1m"; symbol: string; target: number; direction: "high" | "low";
  window_start_utc: string; scanned_until_utc: string; first_touch_utc: string | null; candles_scanned: number;
  touch_semantics?: "final_high_low" | "intracandle_unknown";
}
const assets: Record<string, string> = { bitcoin: "BTC", btc: "BTC", ethereum: "ETH", ether: "ETH", eth: "ETH", solana: "SOL", sol: "SOL", xrp: "XRP", ripple: "XRP", dogecoin: "DOGE", doge: "DOGE", bnb: "BNB", cardano: "ADA", ada: "ADA", chainlink: "LINK", link: "LINK", avalanche: "AVAX", avax: "AVAX", sui: "SUI" };
const months = "January February March April May June July August September October November December".split(" ");
/** Only Binance intrawindow touch propositions; fixed observations are excluded. */
export function parsePriceWindow(inputs: Pick<ModelInputs, "title" | "rules_text" | "gamma_scheduling" | "proposed_value">): PriceWindow | null {
  const { title, rules_text: rules } = inputs;
  if (!/\bBinance\b/iu.test(rules) || /\b(?:Up or Down|close(?:s|d)? above|close(?:s|d)? below)\b/iu.test(title)) return null;
  const match = title.match(/\b(bitcoin|btc|ethereum|ether|eth|solana|sol|xrp|ripple|dogecoin|doge|bnb|cardano|ada|chainlink|link|avalanche|avax|sui)\b[^$?]{0,70}?\b(reach|hit|rise (?:to|above)|above|dip to|fall (?:to|below)|below)\s*\$([\d,]+(?:\.\d+)?)/iu);
  if (!match) return null;
  const named = [...title.matchAll(/\b(bitcoin|btc|ethereum|ether|eth|solana|sol|xrp|ripple|dogecoin|doge|bnb|cardano|ada|chainlink|link|avalanche|avax|sui)\b/giu)].map((m) => assets[m[1]!.toLowerCase()]);
  if (new Set(named).size !== 1 || [...title.matchAll(/\$[\d,.]+/gu)].length !== 1 || /^[A-Za-z.]/u.test(title.slice(match.index! + match[0].length))) return null;
  if (/\b(?:close|closing)\s+price\b|\bcandle\s+close\b/iu.test(rules)) return null;
  const symbol = `${assets[match[1]!.toLowerCase()]}USDT`; const target = Number(match[3]!.replaceAll(",", ""));
  if (!(target > 0) || !Number.isFinite(target)) return null;
  const ruleTargets = [...rules.matchAll(/\$([\d,]+(?:\.\d+)?)/gu)].map((m) => Number(m[1]!.replaceAll(",", "")));
  const pairs = [...rules.matchAll(/\b([A-Z]+)\/?USDT\b/gu)].map((m) => `${m[1]}USDT`);
  if (ruleTargets.some((v) => v !== target) || pairs.some((v) => v !== symbol)) return null;
  const direction = /dip|fall|below/iu.test(match[2]!) ? "low" as const : "high" as const;
  let start: string | null = null; let end: string | null = null;
  const between = rules.match(/\b(?:between|from)\s+([^;\n]{1,160}?)\s*,?\s+(?:and|to|through)\s+([^;\n]{1,160}?)(?=\.(?:\s|$)|\n|$)/iu);
  // Real rule phrasing: "during the date range specified in the title (from 12:00 AM ET on the first date to 11:59 PM ET on the last)".
  // The parenthetical restates the title range, so the title branch below is the authority.
  const titleRange = /date range specified in the title/iu.test(rules) && /\bon the first date\b/iu.test(rules);
  if (between && !titleRange) {
    const zones = [...rules.matchAll(/\b(?:ET|PT|EST|EDT|PST|PDT|UTC|GMT)\b|America\/(?:New_York|Los_Angeles)/gu)].map((m) => m[0]);
    const withZone = (s: string) => new Set(zones).size === 1 && !/\b(?:ET|PT|EST|EDT|PST|PDT|UTC|GMT)\b|America\/(?:New_York|Los_Angeles)/u.test(s) ? `${s} ${zones[0]}` : s;
    start = statedTime(withZone(between[1]!), inputs); end = statedTime(withZone(between[2]!), inputs);
    if (end && /11:59\s*PM/iu.test(between[2]!)) end = new Date(Date.parse(end) + 60_000).toISOString();
    // Explicit but ambiguous rules must never fall back to a title inference.
    if (!start || !end) return null;
  } else {
    const text = `${title} ${rules}`.replace(/\$[\d,.]+/gu, "");
    const explicitYears = [...text.matchAll(/\b20\d{2}\b/gu)].map((m) => Number(m[0]));
    const scheduleYears = [inputs.gamma_scheduling.market, ...inputs.gamma_scheduling.events].flatMap((s) => [s.endDate, s.endDateIso].flatMap((v) => v?.match(/^(20\d{2})-/u)?.[1] ? [Number(v.slice(0, 4))] : []));
    const years = new Set(explicitYears.length ? explicitYears : scheduleYears);
    if (years.size !== 1) return null;
    const year = [...years][0]!;
    const range = title.match(/\b([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/u);
    const monthOnly = title.match(/\bin\s+([A-Za-z]+)\b/iu);
    const name = range?.[1] ?? monthOnly?.[1];
    const month = name ? months.findIndex((m) => m.toLowerCase() === name.toLowerCase()) + 1 : 0;
    if (!month) return null;
    // Title-only date windows follow the explicit rules timezone. Never use listing startDate.
    const zones = [...rules.matchAll(/\b(?:ET|PT|EST|EDT|PST|PDT|UTC|GMT)\b|America\/(?:New_York|Los_Angeles)/gu)].map((m) => m[0]);
    const clocks = [...rules.matchAll(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/giu)].map((m) => m[0].replace(/\s+/gu, " ").toUpperCase());
    const fullDays = titleRange && clocks.length === 2 && clocks[0] === "12:00 AM" && clocks[1] === "11:59 PM";
    if (new Set(zones).size !== 1 || (!fullDays && /\b(?:AM|PM)\b|\d{1,2}:\d{2}/iu.test(rules))) return null;
    const zone = zones[0]!; const a = range ? Number(range[2]) : 1; const b = range ? Number(range[3]) : 0;
    if (range && (b < a || !zonedUtc(year, month, b, 0, 0, zone))) return null;
    start = zonedUtc(year, month, a, 0, 0, zone);
    const next = new Date(Date.UTC(year, range ? month - 1 : month, range ? b + 1 : 1));
    end = zonedUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zone);
  }
  return start && end && Date.parse(end) > Date.parse(start) ? { symbol, target, direction, window_start_utc: start, window_end_utc: end, ...(finalCandleExtrema(rules) ? { final_high_low: true } : {}) } : null;
}
/** A final 1-minute candle High/Low is known at its close, not at the intraminute trade.
 * UMA settled a proposal 15 seconds before that close TOO_EARLY. Without this rule,
 * minute OHLC data cannot locate a touch inside the candle. */
export function finalCandleExtrema(rules: string): boolean {
  return /\b(?:1|one)[- ]minute\b/iu.test(rules) && /\bcandle(?:stick)?s?\b/iu.test(rules) && /\b(?:High|Low)\b/iu.test(rules) && /\bfinal\b/iu.test(rules);
}
export type KlineFetcher = (url: string) => Promise<unknown>;
type Candle = { open: number; close: number; high: number; low: number };
function candles(value: unknown, interval: number): Candle[] {
  if (!Array.isArray(value)) throw new Error("Invalid kline response");
  return value.map((row: unknown) => {
    if (!Array.isArray(row)) throw new Error("Invalid candle");
    const c = { open: Number(row[0]), close: Number(row[6]), high: Number(row[2]), low: Number(row[3]) };
    if (!Object.values(c).every(Number.isFinite) || !Number.isSafeInteger(c.open) || !Number.isSafeInteger(c.close) || c.low <= 0 || c.close !== c.open + interval - 1 || c.open % interval !== 0 || c.high < c.low) throw new Error("Invalid candle");
    return c;
  });
}
/** Sequential, bounded scan. Coverage advances only across contiguous closed candles. */
export async function scanPrice(window: PriceWindow, until: string, fetcher: KlineFetcher,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<PriceEvidence> {
  const start = Date.parse(window.window_start_utc); const end = Math.min(Date.parse(window.window_end_utc) - 1, Date.parse(until));
  if (!Number.isFinite(end) || end < start || start % 60_000) throw new Error("Invalid scan window");
  let requests = 0; let count = 0; let covered = start - 1; let touch: number | null = null;
  const get = async (interval: "1h" | "1m", from: number, to: number): Promise<Candle[]> => {
    if (requests >= 40) throw new Error("Evidence request budget exhausted");
    if (requests++) await pause(250);
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    for (const [k, v] of Object.entries({ symbol: window.symbol, interval, startTime: String(from), endTime: String(to), limit: "1000" })) url.searchParams.set(k, v);
    const rows = candles(await fetcher(url.href), interval === "1h" ? 3_600_000 : 60_000); count += rows.length; return rows;
  };
  const touches = (c: Candle) => window.direction === "high" ? c.high >= window.target : c.low <= window.target;
  let cursor = Math.floor(start / 3_600_000) * 3_600_000;
  scan: while (cursor <= end && requests < 40) {
    const hours = await get("1h", cursor, end); if (!hours.length) break;
    for (const h of hours) {
      if (h.open !== cursor) break scan;
      const from = Math.max(start, h.open); const to = Math.min(end, h.close);
      if (touches(h) || from !== h.open || to !== h.close) {
        if (requests >= 40) break scan;
        const minutes = await get("1m", from, to); let next = from;
        for (const m of minutes) {
          if (m.open !== next || m.close > to) break;
          covered = m.close; next = m.close + 1;
          if (touches(m)) { touch = m.close; break scan; }
        }
        if (covered < to) break scan;
      } else covered = h.close;
      cursor = h.close + 1;
    }
  }
  return { kind: "price_touch", source: "binance_klines_1m", symbol: window.symbol, target: window.target, direction: window.direction,
    window_start_utc: window.window_start_utc, scanned_until_utc: new Date(covered).toISOString(), first_touch_utc: touch === null ? null : new Date(touch).toISOString(), candles_scanned: count, touch_semantics: window.final_high_low ? "final_high_low" : "intracandle_unknown" };
}
