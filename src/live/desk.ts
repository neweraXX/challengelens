import { scopeFromInputs, incompleteGame } from "../gate/sports-scope.js";
import { inPlayPeriod } from "../evidence/sports.js";
import type { SportsScope } from "../gate/sports-scope.js";
import { describeNeeds } from "../gate/needs.js";
import { ADAPTERS } from "../../config/adapters.js";
import { DEPLOYMENTS } from "../../config/pilot.js";
import { decodeAncillary } from "../collect/ancillary.js";
import { FIELDS } from "../collect/goldsky.js";
import type { Ancillary, OracleRequest } from "../collect/types.js";
import { buildLivePacket } from "../demo/live.js";
import type { LiveMarket, LivePacket } from "../demo/live.js";
import { parsePriceWindow } from "../evidence/price.js";
import { asOf, feedNegativeReason } from "../evidence/as-of.js";
import { FEED_NEGATIVE_MARGIN_MS } from "../evidence/as-of.js";
import type { Evidence, EvidenceAsOf } from "../evidence/as-of.js";
import { cutoff, isSports } from "../gate/cutoff.js";
import { earlyYes } from "../gate/decide.js";
import type { GateDecision } from "../gate/decide.js";
import type { Verdict } from "../judge/schema.js";

export type Deployment = typeof DEPLOYMENTS[number];
export type GraphFetcher = (deployment: Deployment, document: string, variables: Record<string, unknown>) => Promise<OracleRequest[]>;
export interface Proposal {
  proposal_id: string; deployment: string; raw: OracleRequest; ancillary: Ancillary;
  title: string; rules_text: string; market_id: string | null;
  proposal_time_utc: string; liveness_ends_utc: string;
}
const known = new Set<string>(ADAPTERS.map((a) => a.address.toLowerCase()));
export function proposalIdentity(deployment: string, row: OracleRequest): string {
  return `${deployment}:${row.id}:${row.proposalHash ?? row.proposalTimestamp}:${row.proposalLogIndex ?? ""}`;
}
export interface DeploymentCount { fetched: number; accepted: number; truncated: boolean }
export type ProposalBatch = Proposal[] & { collection?: { truncated: boolean; deployments: Record<string, DeploymentCount>; fetched_at: string } };
/** Live-only query, round-robin pagination, a hard total cap of 800 rows. */
export async function fetchLiveProposals(fetcher: GraphFetcher, now = Date.now()): Promise<ProposalBatch> {
  const pages: { deployment: Deployment; rows: OracleRequest[] }[] = [];
  const query = `query Live($first: Int!, $skip: Int!, $now: BigInt!) { optimisticPriceRequests(first: $first, skip: $skip, orderBy: proposalTimestamp, orderDirection: desc, where: {state: Proposed, proposalExpirationTimestamp_gt: $now}) { ${FIELDS} } }`;
  const deployments: Record<string, DeploymentCount> = Object.fromEntries(DEPLOYMENTS.map((d) => [d.name, { fetched: 0, accepted: 0, truncated: true }]));
  let count = 0;
  while (count < 800 && Object.values(deployments).some((d) => d.truncated)) {
    for (const deployment of DEPLOYMENTS) {
      const stats = deployments[deployment.name]!;
      if (!stats.truncated || count >= 800) continue;
      const first = Math.min(200, 800 - count);
      const rows = await fetcher(deployment, query, { first, skip: stats.fetched, now: String(Math.floor(now / 1000)) });
      if (rows.length > first) throw new Error("Live page exceeds its bound");
      pages.push({ deployment, rows }); stats.fetched += rows.length; count += rows.length;
      stats.truncated = rows.length === first;
    }
  }
  const unique = new Map<string, Proposal>();
  for (const { deployment, rows } of pages) for (const row of rows) {
    const p = Number(row.proposalTimestamp) * 1000; const end = Number(row.proposalExpirationTimestamp) * 1000;
    if (typeof row.id !== "string" || row.id.length > 2048 || typeof row.requester !== "string" || !known.has(row.requester.toLowerCase()) ||
        row.state !== "Proposed" || !Number.isSafeInteger(p) || p <= 0 || p > now || !Number.isSafeInteger(end) || end <= now ||
        typeof row.ancillaryData !== "string" || row.ancillaryData.length > 200_000) continue;
    const ancillary = decodeAncillary(row.ancillaryData);
    const proposal_id = proposalIdentity(deployment.name, row);
    unique.set(proposal_id, { proposal_id, deployment: deployment.name, raw: row, ancillary,
      title: ancillary.title ?? "Unparseable ancillary", rules_text: ancillary.utf8Valid ? ancillary.decodedText ?? "" : "",
      market_id: ancillary.marketIdHints.length === 1 ? ancillary.marketIdHints[0]! : null,
      proposal_time_utc: new Date(p).toISOString(), liveness_ends_utc: new Date(end).toISOString() });
  }
  const result: ProposalBatch = [...unique.values()];
  for (const p of result) deployments[p.deployment]!.accepted++;
  result.collection = { deployments, truncated: Object.values(deployments).some((d) => d.truncated), fetched_at: new Date(now).toISOString() };
  return result;
}

export interface Game { event_id: string; title: string | null; score: string | null; period: string | null; ended: boolean | null; finished_utc: string | null }
export type DeskMarket = LiveMarket & { sportsMarketType?: string; game?: Game | null };
export type DeskPacket = LivePacket & { sports_market_type?: string | null; game?: Game | null };

export type Screen = "TOO_EARLY_BY_CODE" | "ON_TIME_BY_FEED" | "WITHIN_FEED_LAG" | "PASSES_CODE" | "NO_DETERMINISTIC_KEY";
export interface Screening {
  screen: Screen; reason: string;
  sports_scope: SportsScope; sports_market_type: string | null; proposed_outcome: string; game: Game | null; seconds_after_final: number | null;
  needs: string[]; need_details: NonNullable<GateDecision["need_details"]>;
  instants: { proposal_time_utc: string; code_cutoff_utc: string | null; evidence_time_utc: string | null; scanned_until_utc: string | null };
}
/** No estimated sports durations, price proxies, or early-YES deadline assumptions in desk flags. */
export function screenProposal(packet: DeskPacket, evidence: Evidence | null): Screening {
  const inputs = packet.model_inputs; const code = cutoff(inputs); const view = asOf(evidence, inputs.proposal_time_utc, inputs.rules_text);
  const instants = { proposal_time_utc: inputs.proposal_time_utc, code_cutoff_utc: code?.cutoff_utc ?? null, evidence_time_utc: evidence?.kind === "sports_feed" ? evidence.finished_utc : evidence?.first_touch_utc ?? null, scanned_until_utc: evidence?.kind === "price_touch" ? evidence.scanned_until_utc : null };
  const scope = scopeFromInputs(inputs); const sports = isSports(inputs);
  const baseGame = packet.game ?? (evidence?.kind === "sports_feed" ? { event_id: evidence.event_id || evidence.slug, title: null, score: evidence.score, period: evidence.period, ended: evidence.ended, finished_utc: evidence.finished_utc } : null);
  const game = !sports ? null : baseGame && evidence?.kind === "sports_feed" ? { ...baseGame, score: evidence.score ?? baseGame.score, period: evidence.period ?? baseGame.period, ended: evidence.ended, finished_utc: evidence.finished_utc } : baseGame;
  const result = (screen: Screen, reason: string, needs: string[] = screen === "TOO_EARLY_BY_CODE" ? ["WAIT_UNTIL"] : screen === "NO_DETERMINISTIC_KEY" ? ["NEED_CUTOFF_READING"] : ["NEED_SERV_APPROVAL"]): Screening => ({ screen, reason, instants,
    sports_scope: sports ? scope.scope : "UNKNOWN", sports_market_type: scope.sportsMarketType ?? packet.sports_market_type ?? null, proposed_outcome: scope.proposed_outcome_label,
    game, seconds_after_final: game?.finished_utc ? (Date.parse(inputs.proposal_time_utc) - Date.parse(game.finished_utc)) / 1000 : null,
    needs, need_details: describeNeeds(needs, instants.code_cutoff_utc ?? undefined) });
  if (!packet.fixed_time) return result("NO_DETERMINISTIC_KEY", "unsupported market family or unusable ancillary");
  if (view && "game_finished" in view && sports) {
    if (!view.game_finished) {
      const incomplete = incompleteGame(scope.scope, scope.proposed_outcome_label);
      return result(incomplete.premature ? "TOO_EARLY_BY_CODE" : "NO_DETERMINISTIC_KEY", incomplete.premature ? feedNegativeReason(view) : incomplete.reason, [incomplete.need]);
    }
    instants.evidence_time_utc = view.finished_utc ?? null;
    return result("ON_TIME_BY_FEED", "game finished at proposal time (sports feed)");
  }
  // The feed marked the game final shortly AFTER the proposal. The feed records completion late (see FEED_NEGATIVE_MARGIN_MS),
  // so this is inconclusive inside the negative inference margin: never a flag, never a pass.
  if (sports && evidence?.kind === "sports_feed" && evidence.finished_utc) {
    const lag = Date.parse(evidence.finished_utc) - Date.parse(inputs.proposal_time_utc);
    if (lag > 0 && lag <= FEED_NEGATIVE_MARGIN_MS) return result("WITHIN_FEED_LAG", `feed marked the game final ${Math.round(lag / 1000)} s after the proposal (inside the feed negative inference margin)`, ["NEED_GAME_FINAL"]);
  }
  if (view && "event_occurred" in view && inputs.proposed_value === "1000000000000000000" && parsePriceWindow(inputs)) {
    if (!view.event_occurred) return result("TOO_EARLY_BY_CODE", "event had not occurred at proposal time (price scan)", ["NEED_EVENT_OCCURRED"]);
    instants.evidence_time_utc = view.first_observed_utc ?? null;
    return result("ON_TIME_BY_FEED", "event occurred at proposal time (price scan)");
  }
  if (inputs.proposed_value === "1000000000000000000" && parsePriceWindow(inputs)) return result("NO_DETERMINISTIC_KEY", "early YES needs event evidence", ["NEED_EVENT_OCCURRED"]);
  if (code) {
    if (Date.parse(inputs.proposal_time_utc) >= Date.parse(code.cutoff_utc)) return result("PASSES_CODE", "code cutoff passed");
    if (earlyYes(inputs)) return result("NO_DETERMINISTIC_KEY", "early YES needs event evidence", ["NEED_EVENT_OCCURRED"]);
    return result("TOO_EARLY_BY_CODE", "proposal before code cutoff");
  }
  if (sports) {
    const incomplete = incompleteGame(scope.scope, scope.proposed_outcome_label);
    return result("NO_DETERMINISTIC_KEY", incomplete.premature ? "sports feed has no completion record" : incomplete.reason, [incomplete.need]);
  }
  return result("NO_DETERMINISTIC_KEY", "no supported cutoff pattern");
}
export interface DeskCheck { result: GateDecision; verdict: Verdict; receipt_id: string }
export type Flag = "LIKELY_TOO_EARLY" | "CODE_ONLY" | null;
export function flagFor(screen: Screen, checked?: DeskCheck | null, contemporaneous = false): Flag {
  if (screen !== "TOO_EARLY_BY_CODE") return null;
  return contemporaneous && checked?.result.action === "WAIT" && checked.result.final_reason === "PREMATURE" && checked.verdict.decision === "NOT_SUPPORTED_NOW" && checked.verdict.reason === "PREMATURE"
    ? "LIKELY_TOO_EARLY" : "CODE_ONLY";
}
export function selectServ<T extends { screen: Screen; read: boolean; reread?: boolean }>(rows: T[], sample = 10, cap = 25): T[] {
  return [...rows.filter((r) => !r.read && r.screen === "TOO_EARLY_BY_CODE"), ...rows.filter((r) => !r.read && r.reread && r.screen !== "TOO_EARLY_BY_CODE"), ...rows.filter((r) => !r.read && !r.reread && (r.screen === "PASSES_CODE" || r.screen === "ON_TIME_BY_FEED")).slice(0, sample)].slice(0, cap);
}
export interface FirstSeen { fetched_at: string; ended: boolean | null; period: string | null; score: string | null }
export interface Observation { liveness_ends_utc?: string; seen_at: string; first_seen: FirstSeen | null }
export function contemporaneous(item: Prepared, first: FirstSeen | null): boolean {
  if (cutoff(item.packet.model_inputs)) return true;
  const p = Date.parse(item.proposal.proposal_time_utc);
  const later = item.evidence?.kind === "sports_feed" ? item.evidence : null;
  return [first, later].some((s) => s && s.ended === false && Date.parse(s.fetched_at) > p && inPlayPeriod(s.period));
}
export interface DeskItem extends Screening {
  first_seen?: FirstSeen | null; seen_at?: string; rules_text?: string; raw_evidence?: Evidence | null;
  proposal_id: { short: string; full: string }; request_id: string; deployment: string; requester: string; requester_label: string; requester_verified: boolean;
  title: string; market_id: string | null; event_slug?: string | null; polymarket_url?: string; proposed_side: "YES" | "NO" | "OTHER";
  proposal_time_utc: string; liveness_ends_utc: string; bond_usdc: number | null; currency: string;
  flag: Flag; action?: GateDecision["action"]; receipt_id?: string;
  evidence: EvidenceAsOf | null; proposal_log_index: string | null; tx_hash: string | null; uma_url: string; wording: string | null; source: "uma_live_proposal"; rules_source: string;
}
export interface Snapshot {
  generated_at: string; cycle_ms: number; scope: string;
  totals: { truncated?: boolean; deployments?: Record<string, DeploymentCount>; source_age_seconds?: { subgraph: number | null; gamma: number | null }; detection_delay_seconds?: number | null; in_liveness: number; screened: number; too_early_by_code: number; passes_code: number; on_time_by_feed: number; within_feed_lag: number; median_seconds_after_final: number | null; games: number; bond_in_liveness_usdc: number; gamma_requests?: number; no_key: number; serv_read: number; serv_calls: number; flagged: number };
  bond_at_risk_usdc: number; bond_at_risk_complete: boolean; items: DeskItem[];
}
export interface Prepared { proposal: Proposal; packet: DeskPacket; evidence: Evidence | null; screening: Screening }
export interface CycleFetchers {
  proposals(): Promise<Proposal[]>;
  prepare?(proposals: Proposal[]): Promise<void>;
  gamma(proposal: Proposal): Promise<DeskMarket | null>;
  evidence(packet: LivePacket): Promise<Evidence | null>;
  observe?(item: Prepared, discoveredAt: string): Promise<Observation>;
  saved(proposal: Proposal, item?: Prepared): Promise<{ read: boolean; check: DeskCheck | null; reread?: boolean }>;
  check(item: Prepared): Promise<DeskCheck | null>;
  observed?(): Promise<void>;
  onFlag?(item: Prepared, flaggedAt: string): void;
}
export async function mapLimited<T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>, limit = 4): Promise<R[]> {
  let index = 0; const out = new Array<R>(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const i = index++; out[i] = await mapper(items[i]!, i); }
  })); return out;
}
export function proposalPacket(proposal: Proposal, market: DeskMarket | null, fetchedAt: string): DeskPacket {
  const fallback: LiveMarket = { id: proposal.market_id ?? "", slug: "", question: proposal.title, description: proposal.rules_text, endDate: null,
    gameStartTime: null, startTime: null, closed: null, active: null, outcomes: ["No", "Yes"], scheduling: { market: {}, events: [] } };
  const value = proposal.raw.proposedPrice;
  const usable = value === "0" || value === "1000000000000000000";
  const chosen = market ?? fallback;
  if (market?.sportsMarketType) chosen.scheduling.market.sportsMarketType = market.sportsMarketType;
  const named = chosen.outcomes.findIndex((s) => s.toUpperCase() === (value === "0" ? "NO" : "YES"));
  const packet: DeskPacket = buildLivePacket(chosen, named >= 0 ? named : value === "0" ? 0 : 1, proposal.proposal_time_utc, fetchedAt,
    { proposal_id: proposal.proposal_id, title: proposal.title, rules_text: proposal.rules_text, proposed_value: value === "0" ? "0" : "1000000000000000000" });
  if (!usable || !proposal.ancillary.utf8Valid) { packet.fixed_time = null; packet.unsupported_reason = "unsupported proposal value or ancillary"; }
  packet.sports_market_type = market?.sportsMarketType ?? null; packet.game = market?.game ?? null;
  return packet;
}
// Polygon USDC variants have six decimals. Other collateral is deliberately not converted.
const USDC = new Set(["0x2791bca1f2de4661ed88a30c99a7a9449aa84174", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"]);
export function bondUsdc(raw: OracleRequest): number | null {
  if (!USDC.has(raw.currency.toLowerCase()) || !/^\d+$/u.test(raw.bond) || !Number.isSafeInteger(Number(raw.bond))) return null;
  return Number(raw.bond) / 1e6;
}
export async function runDeskCycle(fetchers: CycleFetchers, options: { sample?: number; cap?: number } = {}, now = Date.now): Promise<Snapshot> {
  const started = now(); const batch = await fetchers.proposals() as ProposalBatch; const proposals = batch.slice(0, 800);
  const discoveredAt = new Date(now()).toISOString();
  await fetchers.prepare?.(proposals);
  const prepared = await mapLimited(proposals, async (proposal): Promise<Prepared> => {
    const market = await fetchers.gamma(proposal).catch(() => null);
    const packet = proposalPacket(proposal, market, new Date(now()).toISOString());
    const evidence = packet.fixed_time ? await fetchers.evidence(packet).catch(() => null) : null;
    return { proposal, packet, evidence, screening: screenProposal(packet, evidence) };
  });
  const rows = await mapLimited(prepared, async (item) => {
    const feed = item.evidence?.kind === "sports_feed" ? item.evidence : null;
    const observation = fetchers.observe ? await fetchers.observe(item, discoveredAt) : { seen_at: discoveredAt, first_seen: feed ? { fetched_at: feed.fetched_at, ended: feed.ended, period: feed.period, score: feed.score } : null };
    return { item, ...item.screening, ...observation, ...await fetchers.saved(item.proposal, item) };
  });
  await fetchers.observed?.();
  let servCalls = 0;
  for (const row of selectServ(rows, options.sample ?? 10, options.cap ?? 25)) {
    // A long scan or prior SERV call can consume the remaining liveness. Never newly flag an expired proposal.
    if (Date.parse(row.item.proposal.liveness_ends_utc) <= now()) continue;
    servCalls++; row.read = true; row.check = await fetchers.check(row.item).catch(() => null);
    if (flagFor(row.screen, row.check, contemporaneous(row.item, row.first_seen)) === "LIKELY_TOO_EARLY" && Date.parse(row.item.proposal.liveness_ends_utc) > now()) fetchers.onFlag?.(row.item, new Date(now()).toISOString());
  }
  const items: DeskItem[] = rows.map(({ item, check, screen, reason, instants, first_seen, seen_at }): DeskItem => {
    const { proposal: p, packet } = item; const flag = flagFor(screen, check, contemporaneous(item, first_seen));
    const value = p.raw.proposedPrice;
    const eventSlugs = [...new Set(packet.model_inputs.gamma_scheduling.events.flatMap((event) => event.slug ? [event.slug] : []))];
    const event_slug = item.evidence?.kind === "sports_feed" && item.evidence.slug ? item.evidence.slug : eventSlugs.length === 1 ? eventSlugs[0]! : null;
    return { event_slug, proposal_id: { short: `${p.deployment}:${p.raw.id.slice(0, 10)}…${p.raw.id.slice(-6)}`, full: p.proposal_id }, request_id: p.raw.id,
      deployment: p.deployment, requester: p.raw.requester, requester_label: ADAPTERS.find((a) => a.address.toLowerCase() === p.raw.requester.toLowerCase())?.label ?? "Unknown", requester_verified: false, title: p.title, market_id: packet.market_id || null,
      ...(packet.market_id && packet.source && packet.market_id !== "" && packet.model_inputs.gamma_scheduling.market.slug ? { polymarket_url: `https://polymarket.com/market/${encodeURIComponent(packet.model_inputs.gamma_scheduling.market.slug)}` } : {}),
      proposed_side: value === "0" ? "NO" : value === "1000000000000000000" ? "YES" : "OTHER", proposal_time_utc: p.proposal_time_utc, liveness_ends_utc: p.liveness_ends_utc,
      first_seen, seen_at, rules_text: packet.model_inputs.rules_text, raw_evidence: item.evidence,
      currency: p.raw.currency, bond_usdc: bondUsdc(p.raw), ...item.screening, screen, reason, instants, flag,
      ...(check ? { action: check.result.action, needs: check.result.needs, ...(check.result.need_details ? { need_details: check.result.need_details } : {}), receipt_id: check.receipt_id } : {}),
      evidence: asOf(item.evidence, p.proposal_time_utc, packet.model_inputs.rules_text) ?? null, proposal_log_index: p.raw.proposalLogIndex, tx_hash: p.raw.proposalHash,
      uma_url: `https://oracle.uma.xyz/?chainId=137&transactionHash=${encodeURIComponent(p.raw.proposalHash ?? p.raw.requestHash)}`,
      wording: flag === "LIKELY_TOO_EARLY" ? "looks too early under the rules; verify before acting" : flag === "CODE_ONLY" ? "Code screen only; SERV has not confirmed this timing concern" : null,
      source: "uma_live_proposal", rules_source: packet.rules_source };
  }).filter((i) => Date.parse(i.liveness_ends_utc) > now());
  const rank = (f: Flag) => f === "LIKELY_TOO_EARLY" ? 0 : f === "CODE_ONLY" ? 1 : 2;
  items.sort((a, b) => rank(a.flag) - rank(b.flag) || a.liveness_ends_utc.localeCompare(b.liveness_ends_utc));
  const flagged = items.filter((i) => i.flag === "LIKELY_TOO_EARLY");
  const delays = items.filter((i) => i.screen === "ON_TIME_BY_FEED" && i.seconds_after_final !== null && i.seconds_after_final >= 0).map((i) => i.seconds_after_final!).sort((a, b) => a - b);
  const median = delays.length ? (delays[Math.floor((delays.length - 1) / 2)]! + delays[Math.floor(delays.length / 2)]!) / 2 : null;
  const detection = items.flatMap((i) => i.seen_at ? [(Date.parse(i.seen_at) - Date.parse(i.proposal_time_utc)) / 1000] : []).sort((a, b) => a - b);
  const detectionMedian = detection.length ? (detection[Math.floor((detection.length - 1) / 2)]! + detection[Math.floor(detection.length / 2)]!) / 2 : null;
  return { generated_at: new Date(now()).toISOString(), cycle_ms: now() - started, scope: "Known requesters; live-only pagination, at most 800 rows across both deployments",
    totals: { truncated: batch.collection?.truncated ?? batch.length > 800, deployments: batch.collection?.deployments ?? {},
      source_age_seconds: { subgraph: batch.collection ? Math.max(0, (now() - Date.parse(batch.collection.fetched_at)) / 1000) : null, gamma: null }, detection_delay_seconds: detectionMedian,
      in_liveness: items.length, screened: items.length, too_early_by_code: items.filter((i) => i.screen === "TOO_EARLY_BY_CODE").length,
      passes_code: items.filter((i) => i.screen === "PASSES_CODE").length,
      on_time_by_feed: items.filter((i) => i.screen === "ON_TIME_BY_FEED").length, within_feed_lag: items.filter((i) => i.screen === "WITHIN_FEED_LAG").length, median_seconds_after_final: median,
      games: new Set(items.flatMap((i) => i.game?.event_id ? [i.game.event_id] : [])).size,
      bond_in_liveness_usdc: items.reduce((sum, i) => sum + (i.bond_usdc ?? 0), 0), no_key: items.filter((i) => i.screen === "NO_DETERMINISTIC_KEY").length,
      serv_read: items.filter((r) => r.action !== undefined).length, serv_calls: servCalls, flagged: flagged.length },
    bond_at_risk_usdc: flagged.reduce((sum, i) => sum + (i.bond_usdc ?? 0), 0), bond_at_risk_complete: flagged.every((i) => i.bond_usdc !== null), items };
}
