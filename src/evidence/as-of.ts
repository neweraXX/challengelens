import { inPlayPeriod } from "./sports.js";
import { finalCandleExtrema } from "./price.js";
import type { SportsEvidence } from "./sports.js";
import type { PriceEvidence } from "./price.js";
export type Evidence = SportsEvidence | PriceEvidence;
export type EvidenceAsOf =
  | { game_finished: boolean; finished_utc?: string; feed_final_delay_minutes?: number; source: "polymarket_gamma_event" }
  | { event_occurred: boolean; first_observed_utc?: string; scanned_until_utc: string; source: "binance_klines_1m" };
/** A feed negative is an INFERENCE, never an observed game-completion instant. */
export const FEED_NEGATIVE_MARGIN_MS = 30 * 60_000;
export function feedNegativeReason(e: { feed_final_delay_minutes?: number }): string {
  return e.feed_final_delay_minutes !== undefined
    ? `feed marked the game final ${Number(e.feed_final_delay_minutes.toFixed(2))} min after the proposal (negative inference)`
    : "feed snapshot more than 30 min after the proposal still showed an in-play period (negative inference)";
}
/** No future timestamps, scores, or end-state fields enter the model packet. */
export function asOf(evidence: Evidence | null | undefined, proposal: string, rules?: string): EvidenceAsOf | undefined {
  const p = Date.parse(proposal); if (!evidence || !Number.isFinite(p)) return undefined;
  if (evidence.kind === "sports_feed") {
    const f = Date.parse(evidence.finished_utc ?? "");
    if (evidence.ended === false && evidence.finished_utc !== null) return undefined;
    if (Number.isFinite(f)) return f <= p ? { game_finished: true, finished_utc: evidence.finished_utc!, source: evidence.source }
      : f - p > FEED_NEGATIVE_MARGIN_MS ? { game_finished: false, feed_final_delay_minutes: (f - p) / 60_000, source: evidence.source } : undefined;
    if (evidence.ended === false && inPlayPeriod(evidence.period) && Date.parse(evidence.fetched_at) - p > FEED_NEGATIVE_MARGIN_MS) return { game_finished: false, source: evidence.source };
  } else {
    const start = Date.parse(evidence.window_start_utc); const until = Date.parse(evidence.scanned_until_utc);
    const touch = Date.parse(evidence.first_touch_utc ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(until) || p < start || until < start || Number.isFinite(touch) && (touch < start || touch > until)) return undefined;
    // Binance labels the last millisecond as closeTime. A final High/Low is decisive only at CLOSE.
    // Otherwise a touch somewhere inside that minute has unknown timing; never infer a negative inside it.
    const finalExtrema = rules !== undefined ? finalCandleExtrema(rules) : evidence.touch_semantics === "final_high_low";
    if (Number.isFinite(touch) && p < touch && p >= Math.floor(touch / 60_000) * 60_000 && !finalExtrema) return undefined;
    if (Number.isFinite(touch) && touch <= p && touch <= until) return { event_occurred: true, first_observed_utc: evidence.first_touch_utc!, scanned_until_utc: evidence.first_touch_utc!, source: evidence.source };
    if (until >= p && (!Number.isFinite(touch) || touch > p)) return { event_occurred: false, scanned_until_utc: new Date(p).toISOString(), source: evidence.source };
  }
  return undefined;
}
