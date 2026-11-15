import { describeNeeds } from "../gate/needs.js";
import { evidenceMarkers } from "../evidence/markers.js";
import { parsePriceWindow } from "../evidence/price.js";
import { inputHash } from "../packets/canonical.js";
import { selectFixedTime } from "../packets/fixed-time.js";
import type { FixedTimeMatch } from "../packets/fixed-time.js";
import type { ModelInputs, Schedule } from "../packets/types.js";
import type { Verdict } from "../judge/schema.js";
import { GATE_VERSION } from "../gate/decide.js";
import type { GateDecision } from "../gate/decide.js";
import { gammaStart, rulesObservationTime } from "./schedule.js";
import { clauseOffsets } from "./math.js";
import type { ShowcaseCase } from "./types.js";

export const LIVE_RULES_SOURCE = "Gamma current question and description; not onchain ancillary bytes. No oracle proposal exists for this check.";
export const ONCHAIN_RULES_SOURCE = "Onchain UMA ancillary text (exact decoded request bytes); Gamma supplies identity and scheduling only, not the governing description.";
export const SUPPORTED_FAMILIES = "Fixed-time crypto prices and candles, sports with a stated scheduled time, and explicit timed observation windows.";
export interface MarketUrl { kind: "event" | "market"; slug: string; market_slug: string | null; url: string }
export class LiveError extends Error {
  constructor(message: string, readonly status = 400, readonly retryAfter = 0) { super(message); }
}
export function parseMarketUrl(value: unknown): MarketUrl {
  if (typeof value !== "string" || value.length > 2048) throw new LiveError("Enter a Polymarket event or market URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new LiveError("Enter a complete HTTPS Polymarket URL."); }
  if (url.protocol !== "https:" || !["polymarket.com", "www.polymarket.com"].includes(url.hostname) || url.port || url.username || url.password) throw new LiveError("Only HTTPS polymarket.com event or market URLs are accepted.");
  const parts = url.pathname.replace(/\/$/u, "").split("/").slice(1);
  if ((parts[0] !== "event" && parts[0] !== "market") || parts.length < 2 || parts.length > (parts[0] === "event" ? 3 : 2) || parts.slice(1).some((s) => !/^[a-z0-9][a-z0-9-]{0,239}$/u.test(s))) throw new LiveError("Use /event/<slug> or /market/<slug>.");
  return { kind: parts[0], slug: parts[1]!, market_slug: parts[2] ?? null, url: `https://polymarket.com/${parts.join("/")}` };
}
export interface LiveMarket {
  id: string; slug: string; question: string; description: string;
  endDate: string | null; gameStartTime: string | null; startTime: string | null;
  closed: boolean | null; active: boolean | null; outcomes: string[];
  scheduling: { market: Schedule; events: Schedule[] };
}
export interface LiveResolution { source: "gamma_live"; rules_source: string; fetched_at: string; url: string; markets: LiveMarket[]; selected_market_id: string | null }
export interface LivePacket {
  source: "gamma_live" | "uma_live_proposal"; proposal_id?: string; rules_source: string; fetched_at: string; market_id: string; outcomes: string[]; proposed_outcome_index: number;
  model_inputs: ModelInputs; packet_hash: string; fixed_time: FixedTimeMatch | null; unsupported_reason: string | null;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function schedule(row: Record<string, unknown>): Schedule {
  const result: Schedule = {};
  for (const key of ["id", "slug", "endDate", "endDateIso", "startDate", "startDateIso", "gameStartTime", "startTime", "eventStartTime", "scheduledStartTime"]) if (typeof row[key] === "string") result[key] = row[key];
  return result;
}
export function gammaMarket(value: unknown, parent?: Record<string, unknown>): LiveMarket {
  if (!record(value) || !/^\d{1,30}$/u.test(String(value.id)) || typeof value.question !== "string" || !value.question.trim()) throw new LiveError("Gamma returned an invalid market.", 502);
  let outcomes: unknown = value.outcomes;
  if (typeof outcomes === "string") { try { outcomes = JSON.parse(outcomes); } catch { outcomes = null; } }
  if (!Array.isArray(outcomes) || outcomes.length < 2 || !outcomes.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 300)) throw new LiveError("Gamma returned invalid outcomes.", 502);
  if (new Set((outcomes as string[]).map((v) => v.trim().toLowerCase())).size !== outcomes.length) throw new LiveError("Gamma returned duplicate outcomes.", 502);
  const events = Array.isArray(value.events) ? value.events.filter(record) : [];
  if (parent) events.push(parent);
  const text = (key: string) => typeof value[key] === "string" ? value[key] : null;
  return { id: String(value.id), slug: text("slug") ?? "", question: value.question, description: text("description") ?? "", endDate: text("endDate"),
    gameStartTime: text("gameStartTime"), startTime: text("startTime"), closed: typeof value.closed === "boolean" ? value.closed : null,
    active: typeof value.active === "boolean" ? value.active : null, outcomes: outcomes as string[], scheduling: { market: { ...schedule(value), id: String(value.id) }, events: events.map(schedule) } };
}
export function minuteTime(value: unknown, now = Date.now()): string {
  if (value === undefined) return new Date(Math.floor(now / 60_000) * 60_000).toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new LiveError("check_time_utc must be a valid ISO UTC timestamp ending in Z.");
  return new Date(Math.floor(Date.parse(value) / 60_000) * 60_000).toISOString();
}
export function buildLivePacket(market: LiveMarket, proposedSide: unknown, time: string, fetchedAt: string, onchain?: { proposal_id: string; title: string; rules_text: string; proposed_value: ModelInputs["proposed_value"] }): LivePacket {
  const binary = market.outcomes.length === 2;
  // The gate's numeric YES value means event-occurrence YES. Up/Down and team
  // names have no safe YES/NO mapping; index proposals remain unsupported.
  const yes = market.outcomes.findIndex((s) => s.toUpperCase() === "YES"); const no = market.outcomes.findIndex((s) => s.toUpperCase() === "NO");
  let index: number;
  if (proposedSide === "YES" || proposedSide === "NO") {
    index = proposedSide === "YES" ? yes : no;
    if (index < 0) throw new LiveError("This market uses named outcomes. Select an outcome index.");
  } else if (typeof proposedSide === "number" && Number.isInteger(proposedSide) && proposedSide >= 0 && proposedSide < market.outcomes.length) index = proposedSide;
  else throw new LiveError("proposed_side must be YES, NO, or a valid zero-based outcome index.");
  const mapped = binary && yes >= 0 && no >= 0;
  const proposed_value = onchain?.proposed_value ?? (mapped ? index === yes ? "1000000000000000000" : "0" : index === 0 ? "1000000000000000000" : "0");
  const model_inputs: ModelInputs = { title: onchain?.title ?? market.question, rules_text: onchain?.rules_text ?? `${market.question}\n\n${market.description}`, proposal_time_utc: onchain ? new Date(time).toISOString() : minuteTime(time), proposed_value,
    gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", ...market.scheduling } };
  const selection = selectFixedTime(model_inputs.title, model_inputs.rules_text, proposed_value);
  // Single-instant/candle or a game winner is symmetric between the two named
  // outcomes. Non-YES/NO observation windows cannot use the early-YES rule safely.
  const namedSymmetric = binary && selection.match !== null && selection.match.kind !== "observation_window";
  const fixed_time = model_inputs.rules_text.trim() && (mapped || namedSymmetric) ? selection.match ?? (mapped && parsePriceWindow(model_inputs) ? { kind: "observation_window" as const, matched_text: model_inputs.title } : null) : null;
  const body = { source: onchain ? "uma_live_proposal" as const : "gamma_live" as const, ...(onchain ? { proposal_id: onchain.proposal_id } : {}), rules_source: onchain ? ONCHAIN_RULES_SOURCE : LIVE_RULES_SOURCE, market_id: market.id, outcomes: market.outcomes, proposed_outcome_index: index, model_inputs };
  // fetched_at describes retrieval, not governing content. The check time is
  // minute-rounded before hashing; changing side, rules or schedules busts cache.
  return { ...body, fetched_at: fetchedAt, packet_hash: inputHash(body), fixed_time,
    unsupported_reason: fixed_time ? null : "market type not supported yet" };
}
export function unsupportedVerdict(packet: LivePacket): Verdict {
  return { decision: "INSUFFICIENT_EVIDENCE", reason: null, decisive_time_utc: null, checks: { timing: { status: "UNKNOWN", clause_quote: packet.model_inputs.title,
    explanation: "Market type not supported yet. No SERV call was made. " + SUPPORTED_FAMILIES } } };
}
export async function assessLive<T>(packet: LivePacket, check: (packet: LivePacket) => Promise<T>): Promise<{ supported: true; checked: T } | { supported: false; verdict: Verdict; result: GateDecision }> {
  if (packet.fixed_time) return { supported: true, checked: await check(packet) };
  const verdict = unsupportedVerdict(packet);
  return { supported: false, verdict, result: { needs: ["NEED_CUTOFF_READING"], need_details: describeNeeds(["NEED_CUTOFF_READING"]), action: "NEED_EVIDENCE", final_decision: "INSUFFICIENT_EVIDENCE", final_reason: null, gate: { version: GATE_VERSION, template: null, code_cutoff_utc: null,
    serv_decisive_time_utc: null, agreement: "NA", serv_self_inconsistent: false, gate_reason: "market type not supported yet", notes: [SUPPORTED_FAMILIES], sports: null } } };
}
export function liveTimeline(packet: LivePacket, verdict: Verdict, result: GateDecision): ShowcaseCase {
  const kind = packet.fixed_time?.kind ?? "unsupported"; const inputs = packet.model_inputs;
  return { ...result, ...evidenceMarkers(result.evidence), source: packet.source, live_packet: packet, case_id: `live-${packet.market_id}-${packet.packet_hash.slice(0, 12)}`, packet_hash: packet.packet_hash,
    event_group: `gamma:${packet.market_id}`, title: inputs.title, category: kind === "sports_scheduled" ? "sports_in_game" : kind.startsWith("crypto") ? "crypto_fixed_time" : "fixed_window",
    fixed_time_kind: kind, rules_text: inputs.rules_text, proposal_time_utc: inputs.proposal_time_utc, dispute_time_utc: null, settlement_time_utc: null,
    settlement_label: null, settlement_value: null, settlement_tx_hash: null, bond: null, reward: null, currency: null, request_id: `gamma-market:${packet.market_id}`, proposal_tx_hash: null,
    gamma_scheduling: inputs.gamma_scheduling, model_inputs: inputs, verdict, clause_offsets: clauseOffsets(inputs.rules_text, verdict.checks.timing.clause_quote) ?? { start: 0, end: 0 },
    raw_verdict: null, raw_run: null, rules_time_utc: rulesObservationTime(inputs, kind), gamma_time_utc: gammaStart(inputs), early_needs_evidence: false };
}
