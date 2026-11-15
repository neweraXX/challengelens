import { gammaMarket } from "../demo/live.js";
import { sportsEvidence } from "../evidence/sports.js";
import type { SportsEvidence } from "../evidence/sports.js";
import { mapLimited } from "./desk.js";
import type { DeskMarket, Game, Proposal } from "./desk.js";

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
export interface GammaResponse { value: unknown; fetched_at: string }
interface Cached { raw: Row | null; fetched_at: string; expires: number }
export class BatchedGamma {
  private readonly markets = new Map<string, Cached>();
  private readonly events = new Map<string, Cached>();
  private readonly pending = new Map<string, Promise<Cached | null>>();
  private readonly feedPending = new Map<string, Promise<Cached | null>>();
  private feedFallbacks = 0;
  private readonly feedTried = new Map<string, number>();
  constructor(private readonly get: (path: string) => Promise<GammaResponse>, private readonly now = Date.now) {}
  private fresh(map: Map<string, Cached>, key: string) { const row = map.get(key); return row && row.expires > this.now() ? row : null; }
  private put(map: Map<string, Cached>, key: string, row: Cached) {
    if (map.size >= 1000 && !map.has(key)) map.delete(map.keys().next().value!);
    map.set(key, row);
  }
  private question(p: Proposal) { return p.ancillary.questionIdHints.length === 1 ? p.ancillary.questionIdHints[0]! : p.ancillary.hypothesizedQuestionId; }
  private eventKey(raw: Row): string | null {
    return typeof raw.id === "string" || typeof raw.id === "number" ? `id:${raw.id}` : typeof raw.slug === "string" ? `slug:${raw.slug}` : null;
  }
  private event(row: Cached): Cached | null {
    const events = row.raw && Array.isArray(row.raw.events) ? row.raw.events.filter(record) : [];
    if (events.length !== 1) return null;
    const key = this.eventKey(events[0]!); if (!key) return null;
    return this.fresh(this.events, key);
  }
  private remember(raw: Row, fetched_at: string) {
    const row = { raw, fetched_at, expires: Date.parse(fetched_at) + 600_000 };
    this.put(this.markets, `id:${raw.id}`, row);
    const question = raw.questionID ?? raw.questionId ?? raw.question_id;
    if (typeof question === "string") this.put(this.markets, `q:${question.toLowerCase()}`, row);
    if (Array.isArray(raw.events)) for (const event of raw.events.filter(record)) {
      const key = this.eventKey(event); if (!key) continue;
      const old = this.fresh(this.events, key);
      // Once the event supplies its final timestamp, a sparse sibling market must not erase it.
      if (old?.raw && sportsEvidence(old.raw, old.fetched_at)?.finished_utc && !sportsEvidence(event, fetched_at)?.finished_utc) continue;
      this.put(this.events, key, { ...row, raw: event });
    }
  }
  async prime(proposals: Proposal[]) {
    this.feedFallbacks = 0;
    const ids = [...new Set(proposals.flatMap((p) => p.market_id && !this.fresh(this.markets, `id:${p.market_id}`) ? [p.market_id] : []))];
    const questions = [...new Set(proposals.flatMap((p) => { const q = this.question(p); return !p.market_id && q && !this.fresh(this.markets, `q:${q}`) ? [q] : []; }))];
    const groups: { key: "id" | "question_ids"; values: string[] }[] = [];
    for (const [key, values] of [["id", ids], ["question_ids", questions]] as const) for (let i = 0; i < values.length; i += 40) groups.push({ key, values: values.slice(i, i + 40) });
    await mapLimited(groups, async ({ key, values }) => {
      try {
        const payload = await this.get(`/markets?${values.map((v) => `${key}=${encodeURIComponent(v)}`).join("&")}&limit=40${key === "question_ids" ? "&closed=any" : ""}`);
        const rows = (Array.isArray(payload.value) ? payload.value : [payload.value]).filter(record);
        for (const raw of rows) {
          const identity = key === "id" ? String(raw.id) : String(raw.questionID ?? raw.questionId ?? raw.question_id).toLowerCase();
          if (values.includes(identity)) this.remember(raw, payload.fetched_at);
        }
      } catch { /* Individual misses use the bounded single-lookup fallback. */ }
    });
  }
  async lookup(p: Proposal): Promise<DeskMarket | null> {
    const id = p.market_id; const q = this.question(p); if (!id && !q) return null;
    const key = id ? `id:${id}` : `q:${q}`;
    let row = this.fresh(this.markets, key);
    if (!row) {
      let task = this.pending.get(key);
      if (!task) {
        task = (async () => {
          const payload = await this.get(id ? `/markets?id=${encodeURIComponent(id)}` : `/markets?question_ids=${encodeURIComponent(q!)}&closed=any`);
          const matches = (Array.isArray(payload.value) ? payload.value : [payload.value]).filter(record).filter((r) => id ? String(r.id) === id : String(r.questionID ?? r.questionId ?? r.question_id).toLowerCase() === q);
          if (matches.length === 1) this.remember(matches[0]!, payload.fetched_at);
          else this.put(this.markets, key, { raw: null, fetched_at: payload.fetched_at, expires: Date.parse(payload.fetched_at) + 600_000 });
          return this.fresh(this.markets, key);
        })();
        this.pending.set(key, task);
      }
      try { row = await task; } finally { this.pending.delete(key); }
    }
    if (!row?.raw) return null;
    const market: DeskMarket = gammaMarket(row.raw);
    if (typeof row.raw.sportsMarketType === "string") {
      market.sportsMarketType = row.raw.sportsMarketType;
      market.scheduling.market.sportsMarketType = row.raw.sportsMarketType;
    }
    market.game = this.game(market.id);
    return market;
  }
  sourceAgeSeconds(ids: string[]): number | null {
    const timestamps = ids.flatMap((id) => {
      const row = this.fresh(this.markets, `id:${id}`); if (!row) return [];
      const event = this.event(row);
      return [row.fetched_at, ...(event ? [event.fetched_at] : [])].map(Date.parse);
    });
    return timestamps.length ? Math.max(0, (this.now() - Math.min(...timestamps)) / 1000) : null;
  }
  game(id: string): Game | null {
    const market = this.fresh(this.markets, `id:${id}`); const event = market && this.event(market);
    if (!event?.raw) return null;
    const e = event.raw; const feed = sportsEvidence(e, event.fetched_at);
    return { event_id: String(e.id ?? e.slug), title: typeof e.title === "string" ? e.title : typeof e.slug === "string" ? e.slug : null,
      score: typeof e.score === "string" ? e.score : null, period: typeof e.period === "string" ? e.period : null,
      ended: typeof e.ended === "boolean" ? e.ended : null, finished_utc: feed?.finished_utc ?? null };
  }
  async evidence(id: string): Promise<SportsEvidence | null> {
    const market = this.fresh(this.markets, `id:${id}`); const event = market && this.event(market);
    if (!event?.raw) return null;
    const embedded = sportsEvidence(event.raw, event.fetched_at); if (embedded) return embedded;
    const key = this.eventKey(event.raw); const slug = event.raw.slug;
    if (!key || typeof slug !== "string") return null;
    let task = this.feedPending.get(key);
    if (!task) {
      if (this.feedFallbacks >= 5 || (this.feedTried.get(key) ?? 0) > this.now()) return null;
      this.feedFallbacks++;
      if (this.feedTried.size >= 1000) this.feedTried.delete(this.feedTried.keys().next().value!);
      this.feedTried.set(key, this.now() + 600_000);
      task = (async () => {
        const payload = await this.get(`/events?slug=${encodeURIComponent(slug)}`);
        const matches = (Array.isArray(payload.value) ? payload.value : [payload.value]).filter(record).filter((r) => r.slug === slug && (event.raw!.id === undefined || String(r.id) === String(event.raw!.id)));
        if (matches.length !== 1) return null;
        const updated = { raw: matches[0]!, fetched_at: payload.fetched_at, expires: Date.parse(payload.fetched_at) + 600_000 };
        this.put(this.events, key, updated); return updated;
      })(); this.feedPending.set(key, task);
    }
    try { const row = await task; return row?.raw ? sportsEvidence(row.raw, row.fetched_at) : null; }
    finally { this.feedPending.delete(key); }
  }
}
