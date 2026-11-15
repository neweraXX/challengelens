import { sha256 } from "./canonical.js";
import type { Category, LabeledCase } from "./types.js";

export const SPLIT_SEED = "challengelens-timing-v1-2026-11-11";
export const CATEGORIES: Category[] = ["sports_in_game", "crypto_fixed_time", "fixed_window", "deadline_no", "politics_news", "other"];
const TARGET = [8, 7, 15, 15] as const; // dev premature/OK, sealed premature/OK
type Counts = [number, number, number, number];
interface Choice { split: "dev" | "sealed"; cases: LabeledCase[] }
interface State { counts: Counts; previous: State | null; choice: Choice | null }

function rank(value: string): string { return sha256(`${SPLIT_SEED}:${value}`); }
function key(counts: Counts): string { return counts.join(","); }

export function selectSplits(eligible: LabeledCase[]): { dev: LabeledCase[]; sealed: LabeledCase[] } {
  const grouped = new Map<string, LabeledCase[]>();
  for (const item of eligible) {
    const group = item.packet.event_group;
    grouped.set(group, [...(grouped.get(group) ?? []), item]);
  }
  const queues = new Map<Category, [string, LabeledCase[]][]>();
  for (const category of CATEGORIES) queues.set(category, []);
  for (const [group, cases] of grouped) {
    cases.sort((a, b) => rank(a.packet.case_id).localeCompare(rank(b.packet.case_id), "en"));
    queues.get(cases[0]!.packet.category)!.push([group, cases]);
  }
  for (const queue of queues.values()) queue.sort((a, b) => rank(a[0]).localeCompare(rank(b[0]), "en"));
  // Round-robin event categories before fitting exact label quotas.
  const groups: LabeledCase[][] = [];
  while ([...queues.values()].some((queue) => queue.length)) {
    for (const category of CATEGORIES) {
      const next = queues.get(category)!.shift();
      if (next) groups.push(next[1]);
    }
  }

  // Small bounded dynamic program: at most 9*8*16*16 count states.
  // Each event is considered once and can contribute at most two cases to ONE split.
  const initial: State = { counts: [0, 0, 0, 0], previous: null, choice: null };
  let states = new Map<string, State>([[key(initial.counts), initial]]);
  const goal = key([...TARGET]);
  for (const group of groups) {
    const premature = group.filter((item) => item.label.label === "PREMATURE").slice(0, 2);
    const okay = group.filter((item) => item.label.label === "TIMING_OK").slice(0, 2);
    const options: LabeledCase[][] = [];
    if (premature[0] && okay[0]) options.push([premature[0], okay[0]]);
    if (premature.length === 2) options.push(premature);
    if (okay.length === 2) options.push(okay);
    if (premature[0]) options.push([premature[0]]);
    if (okay[0]) options.push([okay[0]]);
    const next = new Map(states); // Skip the event, or take one option below.
    for (const state of states.values()) for (const cases of options) {
      const p = cases.filter((item) => item.label.label === "PREMATURE").length;
      const t = cases.length - p;
      for (const split of ["dev", "sealed"] as const) {
        const offset = split === "dev" ? 0 : 2;
        const counts: Counts = [...state.counts];
        counts[offset] = counts[offset]! + p;
        counts[offset + 1] = counts[offset + 1]! + t;
        if (counts.some((count, index) => count > TARGET[index]!)) continue;
        const encoded = key(counts);
        if (!next.has(encoded)) next.set(encoded, { counts, previous: state, choice: { split, cases } });
      }
    }
    states = next;
    if (states.has(goal)) break;
  }
  let state = states.get(goal);
  if (!state) throw new Error(`Cannot fill 15 dev + 30 sealed with exact strata, disjoint events and at most two/event (${eligible.length} eligible cases, ${groups.length} groups). No split files written.`);
  const result: { dev: LabeledCase[]; sealed: LabeledCase[] } = { dev: [], sealed: [] };
  while (state?.choice) {
    result[state.choice.split].push(...state.choice.cases);
    state = state.previous ?? undefined;
  }
  for (const split of [result.dev, result.sealed]) split.sort((a, b) => a.packet.case_id.localeCompare(b.packet.case_id, "en"));
  assertSplits(result);
  return result;
}

export function assertSplits(result: { dev: LabeledCase[]; sealed: LabeledCase[] }): void {
  const devGroups = new Set(result.dev.map((item) => item.packet.event_group));
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const groups = new Map<string, number>();
  for (const split of [result.dev, result.sealed]) for (const item of split) {
    if (ids.has(item.packet.case_id) || hashes.has(item.packet.packet_hash)) throw new Error("Duplicate case or model inputs across selected splits.");
    ids.add(item.packet.case_id);
    hashes.add(item.packet.packet_hash);
    groups.set(item.packet.event_group, (groups.get(item.packet.event_group) ?? 0) + 1);
  }
  if (result.sealed.some((item) => devGroups.has(item.packet.event_group))) throw new Error("Event leakage between dev and sealed.");
  if ([...groups.values()].some((count) => count > 2)) throw new Error("More than two cases from an event.");
  const actual = [result.dev.filter((item) => item.label.label === "PREMATURE").length,
    result.dev.filter((item) => item.label.label === "TIMING_OK").length,
    result.sealed.filter((item) => item.label.label === "PREMATURE").length,
    result.sealed.filter((item) => item.label.label === "TIMING_OK").length];
  if (key(actual as Counts) !== key([...TARGET])) throw new Error("Split label quotas do not match.");
}
