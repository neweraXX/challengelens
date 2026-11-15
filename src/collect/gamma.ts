import { gammaMarket, LiveError, LIVE_RULES_SOURCE, parseMarketUrl } from "../demo/live.js";
import type { LiveMarket, LiveResolution } from "../demo/live.js";
import { GAMMA_URL } from "../../config/pilot.js";
import type { ResponseCache } from "./cache.js";
import { safeMessage } from "./http.js";
import type { Ancillary, GammaAttempt, GammaJoin, GammaMarket } from "./types.js";

function asMarkets(payload: unknown, single: boolean): GammaMarket[] {
  const rows = single ? [payload] : Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "markets" in payload
      ? payload.markets : null;
  if (!Array.isArray(rows) || !rows.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
    throw new Error("Unexpected Gamma response shape; inspect the cached public response.");
  }
  return rows as GammaMarket[];
}

function questionId(market: GammaMarket): string | null {
  for (const key of ["questionID", "questionId", "question_id"]) {
    const value = market[key];
    if (typeof value === "string") return value.toLowerCase();
  }
  return null;
}

export async function joinGamma(cache: ResponseCache, ancillary: Ancillary): Promise<GammaJoin> {
  const result: GammaJoin = {
    status: "not_attempted", hashHypothesisJoined: false, attempts: [], markets: [],
  };
  const lookups: { kind: GammaAttempt["lookup"]; value: string; url: string }[] = [];
  const questionIds = new Set<string>();
  if (ancillary.hypothesizedQuestionId) questionIds.add(ancillary.hypothesizedQuestionId);
  for (const hint of ancillary.questionIdHints.slice(0, 2)) questionIds.add(hint);
  for (const value of questionIds) {
    const url = new URL("/markets", GAMMA_URL);
    url.searchParams.set("question_ids", value);
    url.searchParams.set("closed", "any");
    lookups.push({
      kind: value === ancillary.hypothesizedQuestionId ? "ancillary_keccak" : "question_id_hint",
      value, url: url.href,
    });
  }
  for (const value of ancillary.marketIdHints.slice(0, 2)) {
    lookups.push({ kind: "market_id_hint", value, url: `${GAMMA_URL}/markets/${encodeURIComponent(value)}` });
  }

  for (const lookup of lookups) {
    const attempt: GammaAttempt = {
      lookup: lookup.kind, url: lookup.url, cacheFile: null,
      returnedMarkets: 0, exactMatches: 0, error: null,
    };
    result.attempts.push(attempt);
    try {
      const response = await cache.json<unknown>("gamma", lookup.url);
      attempt.cacheFile = response.cacheFile;
      const markets = asMarkets(response.value, lookup.kind === "market_id_hint");
      attempt.returnedMarkets = markets.length;
      // Never trust that Gamma applied its filter. Confirm the ID in the result.
      const matches = markets.filter((market) => lookup.kind === "market_id_hint"
        ? String(market.id) === lookup.value
        : questionId(market) === lookup.value.toLowerCase());
      attempt.exactMatches = matches.length;
      if (matches.length === 1) {
        result.markets = matches;
        result.status = "joined";
        result.hashHypothesisJoined = lookup.kind === "ancillary_keccak";
        return result;
      }
      if (matches.length > 1) attempt.error = "Multiple exact matches; manual identity review required.";
      else if (markets.length > 0) attempt.error = "Gamma returned markets without the requested ID; not counted as a join.";
    } catch (error) {
      attempt.error = safeMessage(error);
      console.warn(`Gamma ${lookup.kind}: ${attempt.error}`);
    }
  }
  if (lookups.length > 0) {
    result.status = result.attempts.some((attempt) => attempt.error !== null) ? "error" : "not_found";
  }
  return result;
}

// Live intake uses fixed Gamma endpoints, never a user-provided fetch address.
// HTTP transport remains proxy-aware through PublicHttp.text supplied by server.
export class GammaLiveClient {
  private readonly resolutions = new Map<string, { value: LiveResolution; expires: number }>();
  private readonly markets = new Map<string, { market: LiveMarket; fetched_at: string; expires: number }>();
  private readonly pending = new Map<string, Promise<LiveResolution>>();
  private lastFetch = -Infinity;
  constructor(private readonly text: (url: string) => Promise<string>, private readonly now = Date.now) {}
  private async get(path: string): Promise<unknown> {
    const elapsed = this.now() - this.lastFetch;
    if (elapsed < 1000) throw new LiveError("Gamma lookup rate limited. Retry shortly.", 429, Math.ceil((1000 - elapsed) / 1000));
    this.lastFetch = this.now();
    try { return JSON.parse(await this.text(new URL(path, GAMMA_URL).href)) as unknown; }
    catch { throw new LiveError("Gamma is unavailable. Retry or check the configured Polymarket proxy.", 502); }
  }
  private remember(market: LiveMarket, fetched_at: string) {
    if (this.markets.size >= 300) this.markets.delete(this.markets.keys().next().value!);
    this.markets.set(market.id, { market, fetched_at, expires: this.now() + 60_000 });
  }
  async resolve(value: unknown): Promise<LiveResolution> {
    const parsed = parseMarketUrl(value); const known = this.resolutions.get(parsed.url);
    if (known && known.expires > this.now()) return known.value;
    const running = this.pending.get(parsed.url); if (running) return running;
    const task = (async () => {
      const payload = await this.get(`/${parsed.kind === "event" ? "events" : "markets"}?slug=${encodeURIComponent(parsed.slug)}`);
      if (!Array.isArray(payload)) throw new LiveError("Gamma returned an unexpected response.", 502);
      const matches = payload.filter((row: unknown): row is Record<string, unknown> => typeof row === "object" && row !== null && "slug" in row && row.slug === parsed.slug);
      if (matches.length !== 1) throw new LiveError("No unique market/event found for that URL.", 404);
      const row = matches[0]!;
      const markets = parsed.kind === "market" ? [gammaMarket(row)] : Array.isArray(row.markets) ? row.markets.map((m) => gammaMarket(m, row)) : [];
      if (!markets.length || markets.length > 300) throw new LiveError("Event has no usable markets or exceeds the 300-market limit.", 422);
      const fetched_at = new Date(this.now()).toISOString();
      for (const market of markets) this.remember(market, fetched_at);
      const selected = parsed.market_slug ? markets.find((m) => m.slug === parsed.market_slug)?.id ?? null : markets.length === 1 ? markets[0]!.id : null;
      if (parsed.market_slug && !selected) throw new LiveError("The selected market is not part of this event.", 404);
      const result: LiveResolution = { source: "gamma_live", rules_source: LIVE_RULES_SOURCE, fetched_at, url: parsed.url, markets, selected_market_id: selected };
      if (this.resolutions.size >= 100) this.resolutions.delete(this.resolutions.keys().next().value!);
      this.resolutions.set(parsed.url, { value: result, expires: this.now() + 60_000 });
      return result;
    })();
    this.pending.set(parsed.url, task);
    try { return await task; } finally { this.pending.delete(parsed.url); }
  }
  async market(id: unknown): Promise<{ market: LiveMarket; fetched_at: string }> {
    if (typeof id !== "string" || !/^\d{1,30}$/u.test(id)) throw new LiveError("market_id must be a numeric Gamma market ID.");
    const known = this.markets.get(id); if (known && known.expires > this.now()) return known;
    const market = gammaMarket(await this.get(`/markets/${encodeURIComponent(id)}`));
    if (market.id !== id) throw new LiveError("Gamma returned a different market ID.", 502);
    const fetched_at = new Date(this.now()).toISOString(); this.remember(market, fetched_at);
    return { market, fetched_at };
  }
}
