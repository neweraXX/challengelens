import { sha256 } from "./canonical.js";
import type { LabeledCase } from "./types.js";
export const HOLDOUT2_SEED = "challengelens-holdout2-2026-11-14";
export interface ExposedIdentity { case_id: string; event_group?: string }
/** Maximize size (all remaining groups, at most two/group), then minimize label imbalance.
 * Input permutation cannot affect selection. No model verdict or gate outcome is consulted. */
export function selectHoldout2(pool: LabeledCase[], exposed: ExposedIdentity[]) {
  const ids = new Set(exposed.map((r) => r.case_id));
  // Reconstruct a missing showcase group from its identity in the rebuilt pool.
  const groups = new Set(exposed.flatMap((r) => r.event_group ? [r.event_group] : []));
  for (const item of pool) if (ids.has(item.packet.case_id)) groups.add(item.packet.event_group);
  const exclusions = { exposed_case_id: 0, exposed_event_group: 0, event_cap: 0 };
  const byGroup = new Map<string, LabeledCase[]>(); const unique = new Set<string>();
  for (const item of pool) {
    if (unique.has(item.packet.case_id)) throw new Error("Duplicate eligible identity");
    unique.add(item.packet.case_id);
    if (ids.has(item.packet.case_id)) { exclusions.exposed_case_id++; continue; }
    if (groups.has(item.packet.event_group)) { exclusions.exposed_event_group++; continue; }
    byGroup.set(item.packet.event_group, [...(byGroup.get(item.packet.event_group) ?? []), item]);
  }
  const rank = (s: string) => sha256(`${HOLDOUT2_SEED}:${s}`);
  const ranked = [...byGroup].sort((a, b) => rank(a[0]).localeCompare(rank(b[0]), "en")).map(([, rows]) => {
    rows.sort((a, b) => rank(a.packet.case_id).localeCompare(rank(b.packet.case_id), "en"));
    const p = rows.filter((r) => r.label.label === "PREMATURE"); const ok = rows.filter((r) => r.label.label === "TIMING_OK");
    const slots = Math.min(2, rows.length); exclusions.event_cap += rows.length - slots;
    return { p, ok, slots, min: Math.max(0, slots - ok.length), max: Math.min(slots, p.length) };
  });
  const total = ranked.reduce((n, g) => n + g.slots, 0);
  const minimum = ranked.reduce((n, g) => n + g.min, 0); const maximum = ranked.reduce((n, g) => n + g.max, 0);
  let extra = Math.max(minimum, Math.min(maximum, Math.floor(total / 2))) - minimum;
  const selected = ranked.flatMap((g) => {
    const add = Math.min(extra, g.max - g.min); extra -= add;
    const p = g.min + add; return [...g.p.slice(0, p), ...g.ok.slice(0, g.slots - p)];
  });
  selected.sort((a, b) => rank(a.packet.case_id).localeCompare(rank(b.packet.case_id), "en"));
  return { selected, exclusions, excluded_ids: ids.size, excluded_groups: groups.size };
}
