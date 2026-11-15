import type { DeskItem, Screen, Snapshot } from "../../src/live/desk.js";
import type { SportsScope } from "../../src/gate/sports-scope.js";
import { describeNeeds } from "../../src/gate/needs.js";
import type { ShowcaseCase } from "../../src/demo/types.js";

export const screenOrder: Screen[] = ["TOO_EARLY_BY_CODE", "WITHIN_FEED_LAG", "ON_TIME_BY_FEED", "PASSES_CODE", "NO_DETERMINISTIC_KEY"];
const screens: Record<Screen, string> = {
  TOO_EARLY_BY_CODE: "Too early by code", WITHIN_FEED_LAG: "Inside feed lag", ON_TIME_BY_FEED: "Confirmed on time",
  PASSES_CODE: "Passed code cutoff", NO_DETERMINISTIC_KEY: "No deterministic key",
};
const scopes: Record<SportsScope, string> = {
  FULL_GAME_RESULT: "Full-game result", FULL_GAME_THRESHOLD: "Line market: Over/Yes can settle before full time",
  PARTIAL_PERIOD: "Period market", UNKNOWN: "Scope not established",
};
export const humanScreen = (screen: string) => screens[screen as Screen] ?? "Screen unavailable";
export const humanScope = (scope: string) => scopes[scope as SportsScope] ?? "Scope not established";
export const humanNeed = (need: string) => describeNeeds([need])[0]!.text;
export const numberText = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function countdown(ends: string, now: number): string {
  const remaining = Date.parse(ends) - now;
  if (!Number.isFinite(remaining)) return "Time unavailable";
  if (remaining <= 0) return "Window ended";
  const seconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s` : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export const needGroups = [
  { key: "period", label: "Period not provably over" },
  { key: "line", label: "Line may already be crossed" },
  { key: "completion", label: "Feed has no completion record" },
  { key: "rules", label: "Unsupported rules or scope" },
] as const;
export function breakdown(items: Pick<DeskItem, "screen" | "sports_scope" | "needs">[]) {
  const counts = { period: 0, line: 0, completion: 0, rules: 0 };
  for (const item of items) {
    if (item.screen !== "NO_DETERMINISTIC_KEY") continue;
    // Unknown scope can carry a period need, but the missing fact is which rules apply.
    const group = item.needs.includes("NEED_CUTOFF_READING") ? "rules"
      : item.sports_scope === "PARTIAL_PERIOD" ? "period"
      : item.needs.includes("NEED_EVENT_OCCURRED") ? "line"
      : item.needs.includes("NEED_GAME_FINAL") ? "completion"
      : item.sports_scope !== "UNKNOWN" && item.needs.includes("NEED_PERIOD_FINAL") ? "period" : "rules";
    counts[group]++;
  }
  return needGroups.map((group) => ({ ...group, count: counts[group.key] }));
}

export interface LiveResponse {
  generated_at: string | null; items: DeskItem[]; totals: Snapshot["totals"] | null;
  stale: boolean; age_ms: number | null; enabled: boolean;
}
export function teaserText(snapshot: Pick<LiveResponse, "totals" | "stale" | "generated_at"> | null): string {
  if (!snapshot?.totals || !snapshot.generated_at) return "Live desk temporarily unavailable";
  const t = snapshot.totals;
  return `${snapshot.stale ? "Last snapshot" : "Right now"}: ${numberText(t.in_liveness)} proposals in the challenge window · ${numberText(t.bond_in_liveness_usdc)} USDC in bonds · ${numberText(t.flagged)} flagged`;
}
export function finalTiming(seconds: number | null, screen: Screen): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Final time unavailable";
  if (seconds < 0) return `Final marked ${gapText(Math.abs(seconds))} later${screen === "WITHIN_FEED_LAG" ? " (feed lag)" : ""}`;
  return `Proposed ${gapText(seconds)} after final`;
}

export function freshness(snapshot: Pick<LiveResponse, "age_ms" | "generated_at">, receivedAt: number, now: number): string {
  const age = snapshot.age_ms ?? (snapshot.generated_at ? receivedAt - Date.parse(snapshot.generated_at) : NaN);
  if (!Number.isFinite(age)) return "No successful snapshot yet";
  return `Updated ${Math.floor(Math.max(0, age + now - receivedAt) / 1000)} s ago`;
}

/** "3.6 s" under a minute, otherwise "12 min 34 s". */
export function gapText(seconds: number): string {
  const value = Math.abs(seconds);
  if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)} s`;
  const whole = Math.round(value); const minutes = Math.floor(whole / 60); const rest = whole % 60;
  const roundedMinutes = Math.round(value / 60);
  return minutes < 60 ? `${minutes} min ${rest} s` : `${Math.floor(roundedMinutes / 60)} h ${roundedMinutes % 60} min`;
}

/** Display wording only; preserve the source reasons in API payloads and receipts. */
export function humanGateReason(reason: string): string {
  const text = reason.trim();
  const final = /^feed marked the game final ([\d.]+) min after the proposal(?: \(negative inference\))?\.?$/iu.exec(text);
  if (final && Number.isFinite(Number(final[1]))) return `The game was marked final ${gapText(Number(final[1]) * 60)} after this proposal`;
  const inPlay = /^feed snapshot more than ([\d.]+) min after the proposal still showed an in-play period(?: \(negative inference\))?\.?$/iu.exec(text);
  if (inPlay && Number.isFinite(Number(inPlay[1]))) return `The game was still in play ${Number(inPlay[1])}+ min after this proposal`;
  const known: Record<string, string> = {
    "game finished at proposal time (sports feed)": "The game had already finished when this was proposed",
    "needs proof the game finished": "No record that the game finished",
    "sports feed has no completion record": "No record that the game finished",
    "before cutoff": "Proposed before the market's cutoff",
    "proposal before code cutoff": "Proposed before the market's cutoff",
    "both cutoffs passed": "Both clocks had passed",
    "code cutoff passed": "The market's cutoff had passed",
    "SERV approved; evidence proves the event": "SERV agreed and the evidence confirms it",
    "SERV and evidence agree": "SERV agreed and the evidence confirms it",
    "early YES needs event evidence": "A YES this early needs proof the event happened",
    "before sports start": "Proposed before the game started",
    "keys disagree": "The checks disagree",
    "game not finished at proposal time (sports feed)": "The game had not finished when this was proposed",
    "needs the final result": "The final result is still needed",
    "no supported cutoff pattern": "No timing rule the code can check",
  };
  return known[text.replace(/\.$/u, "")] ?? text.charAt(0).toUpperCase() + text.slice(1);
}

const validInstant = (...values: (string | null | undefined)[]) => values.find((value) => value && Number.isFinite(Date.parse(value))) ?? null;
export function explainerData(item?: ShowcaseCase) {
  const receipt = item?.receipt; const gate = receipt?.gate ?? item?.gate;
  const verdict = receipt?.serv_verdict ?? item?.verdict;
  const quote = verdict?.checks.timing.clause_quote?.trim().replace(/\s+/gu, " ") || "No governing clause recorded.";
  const local = verdict?.decisive_local;
  const clock = /^(\d{1,2}):(\d{2})$/u.exec(local?.time ?? "");
  const hour = Number(clock?.[1]);
  const localClock = clock && hour < 24 && Number(clock[2]) < 60 && local?.timezone
    ? `${hour % 12 || 12}:${clock[2]} ${hour >= 12 ? "PM" : "AM"} ${local.timezone}` : "Local clock unavailable";
  const sports = gate?.template === "sports" || item?.category === "sports_in_game";
  // Start times can be computed; estimated sports ends cannot prove completion.
  const codeTime = sports ? validInstant(gate?.sports?.start_utc, item?.gamma_time_utc, item?.rules_time_utc)
    : validInstant(gate?.code_cutoff_utc);
  const evidence = receipt?.evidence ?? item?.evidence;
  const eventTime = evidence?.kind === "sports_feed" ? validInstant(evidence.finished_utc, item?.game_finished_utc)
    : evidence?.kind === "price_touch" ? validInstant(evidence.first_touch_utc, item?.first_touch_utc)
    : validInstant(item?.game_finished_utc, item?.first_touch_utc);
  const proposalTime = validInstant(item?.proposal_time_utc);
  const utcClock = (value: string | null) => value ? `${new Date(value).toISOString().slice(11, 16)} UTC` : "Time unavailable";
  const eventLabel = sports ? "Game final" : "Event observed";
  const fact = eventTime ? `${eventLabel} ${utcClock(eventTime)}${evidence?.kind === "sports_feed" && evidence.score ? ` · score ${evidence.score}` : ""}` : "Event evidence unavailable";
  const times = [codeTime, eventTime, proposalTime].filter((value): value is string => value !== null).map(Date.parse);
  const min = Math.min(...times); const span = Math.max(...times) - min;
  const position = (value: string | null) => value ? span > 0 ? 12 + (Date.parse(value) - min) / span * 76 : 50 : null;
  return {
    title: item?.title || "Featured replay unavailable", quote: quote.length > 60 ? `${quote.slice(0, 59)}…` : quote,
    localClock, utcReading: utcClock(validInstant(gate?.serv_time?.utc, gate?.serv_decisive_time_utc)),
    codeClock: utcClock(codeTime), codeLabel: sports ? codeTime && item?.rules_time_utc && Date.parse(codeTime) !== Date.parse(item.rules_time_utc) ? "Updated game start" : "Game start" : "Code cutoff",
    codeCaption: sports ? "A start time cannot prove completion." : "Compute the cutoff from the rule.",
    fact, eventLabel, proposalClock: utcClock(proposalTime), codePosition: position(codeTime), eventPosition: position(eventTime), proposalPosition: position(proposalTime),
    action: receipt?.action ?? item?.action ?? "NEED_EVIDENCE",
    reason: humanGateReason(gate?.gate_reason || "More evidence is needed before proceeding"),
  };
}
