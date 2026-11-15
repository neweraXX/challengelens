import type { Evidence } from "./as-of.js";
export function evidenceMarkers(evidence?: Evidence | null) {
  return { game_finished_utc: evidence?.kind === "sports_feed" ? evidence.finished_utc : null,
    game_finished_source: "Polymarket sports feed" as const,
    first_touch_utc: evidence?.kind === "price_touch" ? evidence.first_touch_utc : null,
    first_touch_source: "Binance 1m candle" as const };
}
