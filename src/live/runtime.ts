import { BatchedGamma } from "./gamma.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEPLOYMENTS, GAMMA_URL } from "../../config/pilot.js";
import { PublicHttp } from "../collect/http.js";
import type { OracleRequest } from "../collect/types.js";
import type { LivePacket } from "../demo/live.js";
import { checkWithServ } from "../demo/serv.js";
import { asOf } from "../evidence/as-of.js";
import type { Evidence } from "../evidence/as-of.js";
import { EvidenceCollector } from "../evidence/collect.js";
import { parsePriceWindow } from "../evidence/price.js";
import { isSports } from "../gate/cutoff.js";
import { GATE_VERSION, evaluateGate } from "../gate/decide.js";
import { createReceipt, persistReceipt, readReceipt } from "../gate/receipt.js";
import { MODELS } from "../judge/client.js";
import { PROCEDURE_SHA256 } from "../judge/prompt.js";
import { inputHash } from "../packets/canonical.js";
import { fetchLiveProposals, runDeskCycle } from "./desk.js";
import type { Observation, CycleFetchers, DeskCheck, GraphFetcher, Prepared, Proposal, Snapshot } from "./desk.js";
import { historySummary, recordFlags, updateHistory } from "./history.js";
import type { FlagHistory } from "./history.js";
import { servSlots } from "./serv-limit.js";

export function boundedEnv(name: string, fallback: number, max: number, minimum = 0): number {
  const value = process.env[name]; const n = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < minimum || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
type Json = Record<string, unknown>;
const record = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
interface GammaCached { value: unknown; fetched_at: string; expires: number }
export interface SavedCheck { packet_hash?: string; evidence_hash?: string; prior_receipt_ids?: string[]; state: "reserved" | "complete" | "error"; check?: DeskCheck }
async function optionalJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
async function atomic(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value) + "\n", { mode: 0o600 }); await rename(temp, path);
}

export class LiveDesk {
  private readonly http = new PublicHttp({ quiet: true, attempts: 1, timeoutMs: 10_000, redirects: 0 });
  private readonly prices = new EvidenceCollector();
  private readonly batchedGamma: BatchedGamma;
  private readonly gammaCache = new Map<string, GammaCached>();
  private readonly gammaPending = new Map<string, Promise<GammaCached>>();
  private history: FlagHistory[] = [];
  private observations: Record<string, Observation> = {};
  private snapshot: Snapshot | null = null;
  private running: Promise<Snapshot> | null = null;
  private initialized = false;
  private loading: Promise<void> | null = null;
  private servCalls = 0;
  private gammaCalls = 0;
  private priceScans = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  readonly interval = boundedEnv("LIVE_INTERVAL_MS", 180_000, 86_400_000, 1000);
  private readonly gammaCap = boundedEnv("LIVE_GAMMA_MAX_PER_CYCLE", 100, 400);
  private readonly priceCap = boundedEnv("LIVE_PRICE_MAX_PER_CYCLE", 5, 25);
  private readonly servCap = boundedEnv("LIVE_SERV_MAX_PER_CYCLE", 25, 100);
  private readonly sample = boundedEnv("LIVE_SERV_SAMPLE", 10, 100);
  constructor(private readonly directory = ".cache/live", private readonly now = Date.now, private readonly injected?: { fetchers: CycleFetchers; outcomes?: () => Promise<{ deployment: string; raw: OracleRequest }[]> }) { this.batchedGamma = new BatchedGamma((path) => this.gammaJson(path), now); }
  private get graph(): GraphFetcher {
    return async (deployment, document, variables) => {
      // The public subgraph endpoint rate-limits bursts (HTTP 429). Retry with backoff before failing the cycle.
      let text = ""; let lastError: unknown = null;
      for (const waitMs of [0, 4_000, 12_000, 30_000]) {
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
        try { text = await this.http.text(deployment.url, { method: "POST", body: JSON.stringify({ query: document, variables }) }); lastError = null; break; }
        catch (error) { lastError = error; if (!(error instanceof Error) || !/status (429|5\d\d)/u.test(error.message)) break; }
      }
      if (lastError) throw lastError;
      const payload: unknown = JSON.parse(text);
      if (!record(payload) || payload.errors || !record(payload.data) || !Array.isArray(payload.data.optimisticPriceRequests)) throw new Error("Live subgraph unavailable");
      if (payload.data.optimisticPriceRequests.length > Number(variables.first ?? 100)) throw new Error("Live subgraph page exceeds bound");
      return payload.data.optimisticPriceRequests as OracleRequest[];
    };
  }
  private async initialize() {
    if (this.initialized) return;
    if (this.loading) return this.loading;
    const task = this.readState(); this.loading = task;
    try { await task; } finally { this.loading = null; }
  }
  private async readState() {
    await mkdir(join(this.directory, "checks"), { recursive: true });
    this.observations = await optionalJson<Record<string, Observation>>(join(this.directory, "observations.json")) ?? {};
    this.snapshot = await optionalJson<Snapshot>(join(this.directory, "snapshot.json"));
    try {
      const text = await readFile(join(this.directory, "history.jsonl"), "utf8");
      if (text.length > 8_000_000) throw new Error("Live history exceeds retention bound");
      this.history = text.split(/\r?\n/u).filter(Boolean).slice(-2000).map((s) => JSON.parse(s) as FlagHistory);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    this.initialized = true;
  }
  private async gammaJson(path: string): Promise<GammaCached> {
    const url = new URL(path, GAMMA_URL).href;
    const cached = this.gammaCache.get(url); if (cached && cached.expires > this.now()) return cached;
    const pending = this.gammaPending.get(url); if (pending) return pending;
    if (this.gammaCalls >= this.gammaCap) throw new Error("Gamma cycle budget exhausted");
    this.gammaCalls++;
    const task = (async () => {
      const value: unknown = JSON.parse(await this.http.text(url));
      const result = { value, fetched_at: new Date(this.now()).toISOString(), expires: this.now() + 600_000 };
      if (this.gammaCache.size >= 1000) this.gammaCache.delete(this.gammaCache.keys().next().value!);
      this.gammaCache.set(url, result); return result;
    })();
    this.gammaPending.set(url, task);
    try { return await task; } finally { this.gammaPending.delete(url); }
  }
  private async evidence(packet: LivePacket): Promise<Evidence | null> {
    if (parsePriceWindow(packet.model_inputs)) {
      if (this.priceScans >= this.priceCap) return null;
      this.priceScans++; return this.prices.collect({ model_inputs: packet.model_inputs });
    }
    if (!isSports(packet.model_inputs) || !packet.market_id) return null;
    return this.batchedGamma.evidence(packet.market_id);
  }
  private checkPath(p: Pick<Proposal, "proposal_id">) {
    return join(this.directory, "checks", `${inputHash({ proposal_id: p.proposal_id, procedure_sha256: PROCEDURE_SHA256, gate_version: GATE_VERSION })}.json`);
  }
  private async saved(p: Proposal, item?: Prepared) {
    const stored = await optionalJson<SavedCheck>(this.checkPath(p));
    if (!item || !stored) return { read: false, check: null };
    if (!matchesCheck(stored, item)) return { read: false, check: null, reread: true };
    if (stored.check) {
      const receipt = await readReceipt(stored.check.receipt_id);
      if (!receipt || receipt.case_id !== p.proposal_id || receipt.procedure_sha256 !== PROCEDURE_SHA256 || receipt.gate_version !== GATE_VERSION || receipt.packet_hash !== stored.packet_hash || receipt.evidence_hash !== stored.evidence_hash) throw new Error("Live receipt identity mismatch");
      return { read: true, check: { ...stored.check, result: receipt } };
    }
    return { read: stored !== null, check: null };
  }
  private async check(item: Prepared): Promise<DeskCheck | null> {
    if (!process.env.SERV_API_KEY?.trim()) return null;
    const path = this.checkPath(item.proposal);
    const old = await optionalJson<SavedCheck>(path);
    const identity = checkIdentity(item);
    const prior_receipt_ids = [...new Set([...(old?.prior_receipt_ids ?? []), ...(old?.check ? [old.check.receipt_id] : [])])];
    // Reserve before the paid call. Failed/ambiguous responses are never automatically repurchased.
    await atomic(path, { ...identity, prior_receipt_ids, state: "reserved" });
    try {
      await servSlots.wait();
      if (Date.parse(item.proposal.liveness_ends_utc) <= this.now()) { await atomic(path, { ...identity, prior_receipt_ids, state: "error" }); return null; }
      const view = asOf(item.evidence, item.proposal.proposal_time_utc, item.packet.model_inputs.rules_text);
      const inputs = { ...item.packet.model_inputs, ...(view ? { evidence_as_of_proposal: view } : {}) };
      let requestId: string | null = null;
      this.servCalls++;
      const verdict = await checkWithServ(inputs, async (attempt) => { requestId = attempt.serv_request_id ?? null; });
      const result = evaluateGate(inputs, verdict);
      const receipt = createReceipt({ ...result, evidence: item.evidence, packet_hash: item.packet.packet_hash, case_id: item.proposal.proposal_id,
        market_id: item.packet.market_id || null, proposal_time_utc: inputs.proposal_time_utc, model: MODELS.serv,
        serv_request_id: requestId, serv_verdict: verdict, serv_called: true, live_packet: item.packet });
      await persistReceipt(receipt);
      const check = { result: receipt, verdict, receipt_id: receipt.receipt_id };
      await atomic(path, { ...identity, prior_receipt_ids, state: "complete", check }); return check;
    } catch { await atomic(path, { ...identity, prior_receipt_ids, state: "error" }); return null; }
  }
  private async outcomes(snapshot: Snapshot) {
    const active = new Set(snapshot.items.map((i) => i.proposal_id.full));
    const pending = this.history.filter((h) => !h.outcome && (!active.has(h.proposal_id) || Date.parse(h.liveness_ends_utc) <= this.now())).sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? "")).slice(0, 100);
    const results: { deployment: string; raw: OracleRequest }[] = [];
    for (const d of DEPLOYMENTS) {
      const ids = pending.filter((h) => h.deployment === d.name).map((h) => h.request_id);
      if (!ids.length) continue;
      const rows = await this.graph(d, `query Outcomes($ids: [ID!]!) { optimisticPriceRequests(first: 100, where: {id_in: $ids}) { id state proposalHash proposalLogIndex proposalTimestamp disputeTimestamp settlementTimestamp } }`, { ids });
      results.push(...rows.map((raw) => ({ deployment: d.name, raw })));
    }
    const checked = new Set(pending.map((h) => h.proposal_id));
    this.history = this.history.map((h) => checked.has(h.proposal_id) ? { ...h, last_checked_at: new Date(this.now()).toISOString() } : h);
    return results;
  }
  async load() { await this.initialize(); }
  async cycle(): Promise<Snapshot> {
    if (this.running) return this.running;
    const task = (async () => {
      await this.initialize(); this.gammaCalls = 0; this.priceScans = 0; this.servCalls = 0;
      const baseFetchers: CycleFetchers = this.injected?.fetchers ?? { proposals: () => fetchLiveProposals(this.graph, this.now()), prepare: (ps) => this.batchedGamma.prime(ps), gamma: (p) => this.batchedGamma.lookup(p), evidence: (p) => this.evidence(p),
        saved: (p, item) => this.saved(p, item), check: (p) => this.check(p), onFlag: (item, first_flagged_at) => {
          const p = item.proposal;
          if (!this.history.some((h) => h.proposal_id === p.proposal_id)) this.history = [...this.history, { proposal_id: p.proposal_id, request_id: p.raw.id, deployment: p.deployment,
            proposal_time_utc: p.proposal_time_utc, proposal_hash: p.raw.proposalHash, proposal_log_index: p.raw.proposalLogIndex, first_flagged_at, liveness_ends_utc: p.liveness_ends_utc, outcome: null, outcome_at: null }].slice(-2000);
        } };
      const snapshot = await runDeskCycle({ ...baseFetchers, observe: async (item, discoveredAt) => {
        const id = item.proposal.proposal_id; const feed = item.evidence?.kind === "sports_feed" ? item.evidence : null;
        const observation = this.observations[id] ?? { seen_at: discoveredAt, first_seen: null, liveness_ends_utc: item.proposal.liveness_ends_utc };
        if (!observation.first_seen && feed) observation.first_seen = { fetched_at: feed.fetched_at, ended: feed.ended, period: feed.period, score: feed.score };
        this.observations[id] = observation; return observation;
      }, observed: () => atomic(join(this.directory, "observations.json"), this.observations) }, { sample: this.sample, cap: process.env.SERV_API_KEY?.trim() ? this.servCap : 0 }, this.now);
      if (!this.injected) {
        snapshot.totals.source_age_seconds = { subgraph: snapshot.totals.source_age_seconds?.subgraph ?? null, gamma: this.batchedGamma.sourceAgeSeconds(snapshot.items.flatMap((i) => i.market_id ? [i.market_id] : [])) };
        snapshot.totals.serv_calls = this.servCalls; snapshot.totals.gamma_requests = this.gammaCalls; }
      this.history = recordFlags(this.history, snapshot);
      try { this.history = updateHistory(this.history, await (this.injected ? this.injected.outcomes?.() ?? Promise.resolve([]) : this.outcomes(snapshot)), new Date(this.now()).toISOString()); } catch { /* Keep outcomes pending if the subgraph is unavailable. */ }
      const historyPath = join(this.directory, "history.jsonl");
      await writeFile(`${historyPath}.tmp`, this.history.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 }); await rename(`${historyPath}.tmp`, historyPath);
      await atomic(join(this.directory, "snapshot.json"), snapshot);
      this.observations = Object.fromEntries(Object.entries(this.observations).filter(([, o]) => o.liveness_ends_utc && Date.parse(o.liveness_ends_utc) > this.now()));
      await atomic(join(this.directory, "observations.json"), this.observations);
      this.snapshot = snapshot; return snapshot;
    })();
    this.running = task;
    try { return await task; } finally { this.running = null; }
  }
  latest() {
    const age = this.snapshot ? Math.max(0, this.now() - Date.parse(this.snapshot.generated_at)) : null;
    return { ...(this.snapshot ?? { generated_at: null, items: [], totals: null }), stale: age === null || age > 3 * this.interval, age_ms: age };
  }
  async exportProposal(id: string) {
    await this.initialize();
    const item = this.snapshot?.items.find((i) => i.proposal_id.full === id);
    if (!item) return null;
    const stored = await optionalJson<SavedCheck>(this.checkPath({ proposal_id: id }));
    const receiptId = item.receipt_id ?? stored?.check?.receipt_id ?? stored?.prior_receipt_ids?.at(-1);
    return { proposal_id: item.proposal_id.full, request_id: item.request_id, deployment: item.deployment,
      tx_hash: item.tx_hash, proposal_log_index: item.proposal_log_index, rules_text: item.rules_text ?? null,
      instants: { ...item.instants, liveness_ends_utc: item.liveness_ends_utc },
      evidence: item.raw_evidence ?? null, evidence_as_of_proposal: item.evidence, first_seen: item.first_seen ?? null,
      screen: item.screen, reason: item.reason, needs: item.needs,
      serv_receipt_current: Boolean(item.receipt_id), prior_receipt_ids: stored?.prior_receipt_ids ?? [],
      serv_receipt: receiptId ? await readReceipt(receiptId) : null };
  }
  historySummary() { return historySummary(this.history); }
  start() {
    if (this.timer || this.stopped) return;
    const tick = async () => {
      const started = this.now();
      try { const snapshot = await this.cycle(); console.log(`Live desk cycle ok: ${JSON.stringify(snapshot.totals)}`); }
      catch (error) { /* Last successful snapshot remains available, with an age/stale marker. */ console.error(`Live desk cycle failed: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "unknown error"}`); }
      if (!this.stopped) { this.timer = setTimeout(() => { void tick(); }, Math.max(1, this.interval - (this.now() - started))); this.timer.unref(); }
    };
    this.timer = setTimeout(() => { void tick(); }, 1500); this.timer.unref();
  }
  async close() { this.stopped = true; if (this.timer) clearTimeout(this.timer); await this.running?.catch(() => {}); await this.http.close(); await this.prices.close(); }
}

export function checkIdentity(item: Prepared) {
  return { packet_hash: item.packet.packet_hash,
    evidence_hash: inputHash(asOf(item.evidence, item.proposal.proposal_time_utc, item.packet.model_inputs.rules_text) ?? null) };
}
export function matchesCheck(stored: SavedCheck, item: Prepared): boolean {
  const current = checkIdentity(item);
  return stored.packet_hash === current.packet_hash && stored.evidence_hash === current.evidence_hash;
}
