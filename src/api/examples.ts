import { cryptoExamples, exampleLink, EXAMPLE_MARGIN_MS } from "../demo/example-links.js";
import type { ExampleLink, ExampleResponse } from "../demo/example-links.js";
import type { LiveResolution } from "../demo/live.js";
import type { DeskItem } from "../live/desk.js";

export const EXAMPLES_TTL_MS = 10 * 60_000;
export const EXAMPLES_REQUEST_CAP = 12;
type SportsItem = Pick<DeskItem, "game" | "event_slug" | "polymarket_url">;
type Snapshot = { items: SportsItem[]; stale?: boolean };
type SportsExample = ExampleLink & { valid_until: number };
export function sportsExamples(snapshot: Snapshot, now: number): SportsExample[] {
  if (snapshot.stale) return [];
  const out: SportsExample[] = [];
  for (const item of snapshot.items.slice(0, 800)) {
    const game = item.game; if (!game) continue;
    const finished = Date.parse(game.finished_utc ?? "");
    const inPlay = game.ended === false;
    if (!inPlay && !(Number.isFinite(finished) && finished <= now && finished >= now - 3 * 3_600_000)) continue;
    let slug = item.event_slug;
    if (!slug && item.polymarket_url) {
      const known = exampleLink({ label: "Game", url: item.polymarket_url });
      if (known && new URL(known.url).pathname.startsWith("/event/")) slug = new URL(known.url).pathname.split("/")[2];
    }
    if (!slug || !/^[a-z0-9][a-z0-9-]{0,239}$/u.test(slug)) continue;
    const link = { label: inPlay ? "A game in play" : "A game that just finished", url: `https://polymarket.com/event/${slug}`,
      kind: "sports" as const, valid_until: inPlay ? now + EXAMPLES_TTL_MS : Math.min(now + EXAMPLES_TTL_MS, finished + 3 * 3_600_000), note: inPlay ? "The latest live-desk feed shows this game in play." : "The live-desk feed marked this game final within the last three hours." };
    if (!out.some((r) => r.url === link.url)) out.push(link);
  }
  return out;
}
/** A selected nested market must itself be open; other event siblings cannot validate it. */
export function openUntil(resolution: LiveResolution, now: number, kind: ExampleLink["kind"] = "crypto"): number | null {
  const markets = resolution.selected_market_id ? resolution.markets.filter((m) => m.id === resolution.selected_market_id) : resolution.markets;
  const open = markets.filter((m) => m.closed === false && m.active !== false);
  // Sports can still be in play/unresolved after their scheduled endDate. The
  // snapshot bounds their age; the twenty-minute future window is for price/static links.
  if (kind === "sports") return open.length ? now + EXAMPLES_TTL_MS : null;
  const ends = open.map((m) => Date.parse(m.endDate ?? "")).filter((end) => Number.isFinite(end) && end > now + EXAMPLE_MARGIN_MS);
  return ends.length ? Math.max(...ends) - EXAMPLE_MARGIN_MS : null;
}
interface Validated { link: ExampleLink; until: number }
export class MarketExamples {
  private cached: { generated_at: string; entries: Validated[]; expires: number } | null = null;
  private pending: Promise<ExampleResponse> | null = null;
  private lastFinished = -Infinity;
  constructor(private readonly deps: {
    resolve(url: string): Promise<LiveResolution>;
    snapshot(): Snapshot;
    fallback(): Promise<unknown>;
    now?: () => number;
    pause?: (ms: number) => Promise<void>;
  }) {}
  private now() { return (this.deps.now ?? Date.now)(); }
  private view(): ExampleResponse {
    return { generated_at: this.cached!.generated_at, examples: this.cached!.entries.filter((entry) => entry.until > this.now()).map((entry) => entry.link) };
  }
  async get(): Promise<ExampleResponse> {
    if (this.cached && this.cached.expires > this.now()) return this.view();
    if (this.pending) return this.pending;
    const task = this.refresh(); this.pending = task;
    try { return await task; } finally { this.pending = null; }
  }
  private async refresh(): Promise<ExampleResponse> {
    const now = this.now(); const entries: Validated[] = []; const seen = new Set<string>(); let requests = 0;
    const validate = async (candidate: ExampleLink & { valid_until?: number }): Promise<boolean> => {
      const link = exampleLink(candidate, candidate.kind);
      if (!link || requests >= EXAMPLES_REQUEST_CAP || seen.has(link.url) || entries.length >= 3) return false;
      seen.add(link.url); requests++;
      // GammaLiveClient retains its one-per-second limiter. Pace after completion,
      // including failures, so the next lookup cannot race the previous slot.
      const wait = 1000 - (this.now() - this.lastFinished);
      if (wait > 0) await (this.deps.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
      try {
        const resolved = await this.deps.resolve(link.url);
        if (resolved.url !== link.url) return false;
        const open = openUntil(resolved, this.now(), link.kind); if (open === null) return false;
        const until = Math.min(open, candidate.valid_until ?? Infinity); if (until <= this.now()) return false;
        entries.push({ link, until }); return true;
      } catch { return false; }
      finally { this.lastFinished = this.now(); }
    };
    for (const asset of ["bitcoin", "ethereum"] as const) for (const candidate of cryptoExamples(now, asset)) if (await validate(candidate)) break;
    let snapshot: Snapshot = { items: [] };
    try { snapshot = this.deps.snapshot(); } catch { /* No live game is required. */ }
    for (const candidate of sportsExamples(snapshot, this.now())) {
      if (entries.length >= 3 || requests >= EXAMPLES_REQUEST_CAP) break;
      if (await validate(candidate)) break;
    }
    if (entries.length < 3 && requests < EXAMPLES_REQUEST_CAP) {
      const fallback = await this.deps.fallback().catch(() => []);
      if (Array.isArray(fallback)) for (const row of fallback.slice(0, 100)) {
        if (entries.length >= 3 || requests >= EXAMPLES_REQUEST_CAP) break;
        const candidate = exampleLink(row); if (candidate) await validate({ ...candidate, note: "An open market from the saved examples." });
      }
    }
    this.cached = { generated_at: new Date(this.now()).toISOString(), entries, expires: this.now() + EXAMPLES_TTL_MS };
    return this.view();
  }
}
