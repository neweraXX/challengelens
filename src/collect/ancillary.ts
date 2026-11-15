import { keccak_256 } from "@noble/hashes/sha3";
import type { Ancillary } from "./types.js";

function uniqueHints(text: string, expression: RegExp): string[] {
  return [...new Set([...text.matchAll(expression)].map((match) => match[1]!.toLowerCase()))].sort();
}

export function decodeAncillary(hex: string): Ancillary {
  const result: Ancillary = {
    decodedText: null, utf8Valid: false, error: null,
    title: null, description: null, resolutionRules: null, extraction: "heuristic",
    questionIdHints: [], marketIdHints: [], hypothesizedQuestionId: null,
  };
  if (!/^0x(?:[0-9a-f]{2})*$/iu.test(hex)) {
    result.error = "Ancillary data is not an even-length hex byte string.";
    return result;
  }
  const bytes = Buffer.from(hex.slice(2), "hex");
  // Ethereum Keccak, NOT the different NIST SHA3-256 function. Hash raw bytes.
  result.hypothesizedQuestionId = `0x${Buffer.from(keccak_256(bytes)).toString("hex")}`;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    result.utf8Valid = true;
  } catch {
    result.decodedText = new TextDecoder("utf-8").decode(bytes);
    result.error = "Ancillary bytes contain invalid UTF-8; display text has replacement characters.";
    return result;
  }
  result.decodedText = text;

  // Ancillary formats vary. Preserve the complete text above; these fields are
  // convenience extractions and never an assertion of the historical rule version.
  const markers = [...text.matchAll(
    /(?:^|[\r\n,;])\s*(?:q\s*:\s*)?(title|description|resolution(?:[_ ]rules)?|rules|res_data)\s*:\s*/giu,
  )];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const start = marker.index! + marker[0].length;
    const end = markers[index + 1]?.index ?? text.length;
    const value = text.slice(start, end).trim();
    const name = marker[1]!.toLowerCase();
    if (name === "title" && !result.title) result.title = value || null;
    else if (name === "description" && !result.description) result.description = value || null;
    else if (!["title", "description"].includes(name) && value) {
      result.resolutionRules = [result.resolutionRules, value].filter(Boolean).join("\n");
    }
  }
  if (!result.title) {
    result.title = text.replace(/^\s*q\s*:\s*/iu, "").split(/\r?\n/u)[0]!
      .split(/,\s*(?:description|res_data|rules)\s*:/iu)[0]!.trim().slice(0, 300) || null;
  }
  // For unlabelled formats, retain all ancillary text as candidate rule material.
  result.resolutionRules ??= result.description ?? (text.trim() || null);
  result.questionIdHints = uniqueHints(text,
    /\bquestion[_\s-]?id["']?\s*[:=]\s*["']?(0x[0-9a-f]{64})\b/giu);
  result.marketIdHints = uniqueHints(text,
    /\bmarket[_\s-]?id["']?\s*[:=]\s*["']?(\d+)\b/giu);
  return result;
}

export function pricesDiffer(proposed: string | null, settled: string | null): boolean | null {
  if (typeof proposed !== "string" || typeof settled !== "string" ||
      !/^-?\d+$/u.test(proposed) || !/^-?\d+$/u.test(settled)) return null;
  return BigInt(proposed) !== BigInt(settled);
}
