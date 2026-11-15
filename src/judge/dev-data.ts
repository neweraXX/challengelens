import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { SCHEDULE_KEYS } from "../packets/build.js";
import { inputHash, sha256 } from "../packets/canonical.js";
import { selectFixedTime } from "../packets/fixed-time.js";
import type { CaseLabel, CasePacket, ModelInputs } from "../packets/types.js";
import { exactKeys, object, validUtc } from "./validate.js";

export function assertDevPath(path: string, name: "packets.jsonl" | "labels.jsonl"): string {
  const expected = resolve("data/dev", name);
  if (resolve(path) !== expected || resolve(path).split(/[\\/]/u).some((part) => part.toLowerCase() === "sealed")) {
    throw new Error("Pilot inference is restricted to the fixed data/dev files; sealed paths are forbidden.");
  }
  return expected;
}

export function assertModelInputs(value: unknown): asserts value is ModelInputs {
  if (!object(value) || !exactKeys(value, ["title", "rules_text", "proposal_time_utc", "proposed_value", "gamma_scheduling", ...(Object.hasOwn(value, "evidence_as_of_proposal") ? ["evidence_as_of_proposal"] : [])]) ||
      typeof value.title !== "string" || !value.title.trim() || typeof value.rules_text !== "string" || !value.rules_text.trim() ||
      !validUtc(value.proposal_time_utc) || (value.proposed_value !== "0" && value.proposed_value !== "1000000000000000000")) {
    throw new Error("Invalid or unexpected model input fields (possible label/outcome leakage).");
  }
  if (Object.hasOwn(value, "evidence_as_of_proposal")) {
    const e = value.evidence_as_of_proposal;
    const p = Date.parse(value.proposal_time_utc as string);
    const knownTime = (t: unknown) => validUtc(t) && Date.parse(t as string) <= p;
    const sport = object(e) && e.source === "polymarket_gamma_event" && typeof e.game_finished === "boolean" &&
      exactKeys(e, e.game_finished ? ["source", "game_finished", "finished_utc"] : ["source", "game_finished", ...(Object.hasOwn(e, "feed_final_delay_minutes") ? ["feed_final_delay_minutes"] : [])]) && (!e.game_finished || knownTime(e.finished_utc)) && (e.feed_final_delay_minutes === undefined || typeof e.feed_final_delay_minutes === "number" && Number.isFinite(e.feed_final_delay_minutes) && e.feed_final_delay_minutes > 30);
    const price = object(e) && e.source === "binance_klines_1m" && typeof e.event_occurred === "boolean" &&
      exactKeys(e, e.event_occurred ? ["source", "event_occurred", "first_observed_utc", "scanned_until_utc"] : ["source", "event_occurred", "scanned_until_utc"]) &&
      knownTime(e.scanned_until_utc) && (!e.event_occurred || knownTime(e.first_observed_utc));
    if (!sport && !price) throw new Error("Invalid as-of evidence envelope");
  }
  const scheduling = value.gamma_scheduling;
  if (!object(scheduling) || !exactKeys(scheduling, ["provenance", "market", "events"]) ||
      scheduling.provenance !== "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY" || !Array.isArray(scheduling.events)) {
    throw new Error("Invalid Gamma scheduling envelope.");
  }
  for (const schedule of [scheduling.market, ...scheduling.events]) {
    if (!object(schedule) || Object.entries(schedule).some(([key, field]) =>
      !(SCHEDULE_KEYS as readonly string[]).includes(key) || typeof field !== "string")) {
      throw new Error("Only allowlisted scheduling strings are permitted; Gamma outcomes/statuses are forbidden.");
    }
  }
}

export interface DevData {
  packets: CasePacket[];
  labels: Map<string, CaseLabel>;
  packetFileHash: string;
  labelFileHash: string;
}

export async function loadDevData(): Promise<DevData> {
  async function read(name: "packets.jsonl" | "labels.jsonl"): Promise<string> {
    const path = assertDevPath(`data/dev/${name}`, name);
    if (await realpath(path) !== path) throw new Error("Symlinks are forbidden for pilot input paths.");
    return readFile(path, "utf8");
  }
  const packetText = await read("packets.jsonl");
  const labelText = await read("labels.jsonl");
  const packets = packetText.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line) as CasePacket);
  const labelRows = labelText.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line) as CaseLabel);
  if (packets.length !== 15 || labelRows.length !== 15) throw new Error("Pilot requires exactly 15 dev packets and 15 separate labels.");
  const labels = new Map(labelRows.map((label) => [label.case_id, label]));
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const packet of packets) {
    if (packet.schema_version !== "timing-packet-1" || typeof packet.case_id !== "string" ||
        !/^timing-[0-9a-f]{24}$/u.test(packet.case_id)) throw new Error("Invalid timing packet identity.");
    assertModelInputs(packet.model_inputs);
    const input = packet.model_inputs;
    if (!packet.fixed_time || !selectFixedTime(input.title, input.rules_text, input.proposed_value).match) {
      throw new Error(`Dev packet is outside fixed-time scope; rebuild with npm run packets: ${packet.case_id}`);
    }
    if (inputHash(packet.model_inputs) !== packet.packet_hash) throw new Error(`Packet hash mismatch: ${packet.case_id}`);
    if (ids.has(packet.case_id) || hashes.has(packet.packet_hash)) throw new Error("Duplicate dev packet identity or model inputs.");
    ids.add(packet.case_id);
    hashes.add(packet.packet_hash);
    const label = labels.get(packet.case_id);
    if (!label || label.packet_hash !== packet.packet_hash || !["PREMATURE", "TIMING_OK"].includes(label.label)) {
      throw new Error(`Missing/mismatched dev label: ${packet.case_id}`);
    }
    const premature = label.label === "PREMATURE";
    if (label.expected_decision !== (premature ? "NOT_SUPPORTED_NOW" : "SUPPORTED_NOW") ||
        label.expected_reason !== (premature ? "PREMATURE" : null)) throw new Error("Inconsistent dev label expectations.");
  }
  if (labels.size !== 15 || labelRows.filter((label) => label.label === "PREMATURE").length !== 8) {
    throw new Error("Dev label strata or unique identities do not match the frozen 8/7 design.");
  }
  return { packets, labels, packetFileHash: sha256(packetText), labelFileHash: sha256(labelText) };
}
