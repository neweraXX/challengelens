import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PublicHttp } from "../collect/http.js";
import { isSports } from "../gate/cutoff.js";
import { inputHash } from "../packets/canonical.js";
import type { ModelInputs } from "../packets/types.js";
import { asOf } from "./as-of.js";
import type { Evidence } from "./as-of.js";
import { parsePriceWindow, scanPrice } from "./price.js";
import { sportsEvidence } from "./sports.js";

type PacketIdentity = { model_inputs: ModelInputs; event_group?: string };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Gamma always uses the existing proxy-aware transport; Binance stays direct. */
export class EvidenceCollector {
  constructor(private readonly http: Pick<PublicHttp, "text" | "close"> = new PublicHttp({ quiet: true }), private readonly directory = ".cache/evidence", private readonly now = Date.now) {}
  async collect(packet: PacketIdentity): Promise<Evidence | null> {
    const inputs = packet.model_inputs; const window = parsePriceWindow(inputs);
    if (!window && !isSports(inputs)) return null;
    const until = new Date(Math.min(this.now(), window ? Date.parse(window.window_end_utc) - 1 : this.now())).toISOString();
    const key = inputHash({ evidence_policy: "evidence-v8", inputs: { title: inputs.title, rules: inputs.rules_text, scheduling: inputs.gamma_scheduling }, window, until: window && Date.parse(window.window_end_utc) <= this.now() ? window.window_end_utc : Math.floor(this.now() / 60_000) });
    const path = join(this.directory, `${key}.json`);
    try { return JSON.parse(await readFile(path, "utf8")) as Evidence | null; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid evidence cache"); }
    let evidence: Evidence | null = null;
    if (window) {
      if (Date.parse(until) < Date.parse(window.window_start_utc)) return null;
      evidence = await scanPrice(window, until, async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
        if (!response.ok) throw new Error("Price evidence unavailable");
        return response.json();
      });
    } else {
      const schedules = inputs.gamma_scheduling;
      let events: Record<string, unknown>[] = [];
      const marketId = schedules.market.id ?? packet.event_group?.match(/^market:id:(\d+)$/u)?.[1];
      const marketSlug = schedules.market.slug;
      if (marketId || marketSlug) {
        const payload: unknown = JSON.parse(await this.http.text(marketId ? `https://gamma-api.polymarket.com/markets?id=${encodeURIComponent(marketId)}` : `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(marketSlug!)}`));
        const markets = (Array.isArray(payload) ? payload : [payload]).filter(record).filter((m) => marketId ? String(m.id) === marketId : m.slug === marketSlug);
        if (markets.length !== 1) throw new Error("Evidence market identity mismatch");
        if (Array.isArray(markets[0]!.events)) events = markets[0]!.events.filter(record);
      } else {
        const event = schedules.events.find((s) => s.slug || s.id);
        const eventSlug = event?.slug ?? packet.event_group?.match(/^event:slug:(.+)$/u)?.[1];
        const eventId = event?.id ?? packet.event_group?.match(/^event:id:(\d+)$/u)?.[1];
        if (eventSlug || eventId) {
          const payload: unknown = JSON.parse(await this.http.text(eventSlug ? `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(eventSlug)}` : `https://gamma-api.polymarket.com/events/${encodeURIComponent(eventId!)}`));
          events = (Array.isArray(payload) ? payload : [payload]).filter(record).filter((e) => eventSlug ? e.slug === eventSlug : String(e.id) === eventId);
        }
      }
      // Some embedded events omit feed fields. Retrieve the exact event by slug.
      if (events.length === 1 && typeof events[0]!.slug === "string") {
        const slug = events[0]!.slug; const expectedId = events[0]!.id;
        const payload: unknown = JSON.parse(await this.http.text(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`));
        if (Array.isArray(payload)) events = payload.filter(record).filter((e) => e.slug === slug && (expectedId === undefined || String(e.id) === String(expectedId)));
      }
      if (events.length === 1) evidence = sportsEvidence(events[0]!, new Date(this.now()).toISOString());
    }
    await mkdir(this.directory, { recursive: true });
    const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify(evidence) + "\n"); await rename(temporary, path);
    return evidence;
  }
  async close() { await this.http.close(); }
}
export interface EvidenceRow { case_id: string; packet_hash: string; evidence: Evidence | null; error: string | null }
export async function loadEvidence(path: string): Promise<EvidenceRow[]> {
  try { return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((s) => JSON.parse(s) as EvidenceRow); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
export function attachEvidence<T extends { case_id: string; packet_hash: string; model_inputs: ModelInputs }>(packets: T[], rows: EvidenceRow[]): T[] {
  const map = new Map(rows.map((r) => [r.case_id, r]));
  if (map.size !== rows.length) throw new Error("Duplicate evidence rows");
  return packets.map((p) => {
    const row = map.get(p.case_id);
    if (row && row.packet_hash !== p.packet_hash) throw new Error("Evidence packet mismatch");
    const { evidence_as_of_proposal: _old, ...original } = p.model_inputs;
    const value = asOf(row?.evidence, original.proposal_time_utc, original.rules_text);
    return { ...p, model_inputs: { ...original, ...(value ? { evidence_as_of_proposal: value } : {}) } };
  });
}
