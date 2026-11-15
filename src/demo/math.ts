import type { Verdict } from "../judge/schema.js";

/** A tiny invertible scale used by the SVG and pointer interaction. */
export function linearScale(domain: [number, number], range: [number, number]) {
  const span = domain[1] - domain[0] || 1;
  const output = range[1] - range[0] || 1;
  return {
    map: (value: number) => range[0] + (value - domain[0]) / span * output,
    invert: (pixel: number) => domain[0] + (pixel - range[0]) / output * span,
  };
}

export function snapMinute(time: number): number { return Math.round(time / 60_000) * 60_000; }
export function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

/** This is a cutoff comparison, not a new model judgment or outcome check. */
export function recomputeVerdict(cutoff: string | null, proposal: number, earlyNeedsEvidence: boolean): Verdict["decision"] {
  if (!cutoff || !Number.isFinite(Date.parse(cutoff)) || !Number.isFinite(proposal)) return "INSUFFICIENT_EVIDENCE";
  if (proposal >= Date.parse(cutoff)) return "SUPPORTED_NOW";
  return earlyNeedsEvidence ? "INSUFFICIENT_EVIDENCE" : "NOT_SUPPORTED_NOW";
}

function normalizedWithOffsets(source: string) {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  // Work in UTF-16 offsets, matching String.slice and React text rendering.
  // Include combining marks in each cluster before NFKC normalization.
  for (const match of source.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const cluster = match[0];
    offset = match.index!;
    const normalized = cluster.normalize("NFKC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
    for (const char of normalized) {
      const value = /\s/u.test(char) ? " " : char;
      if (value === " " && text.endsWith(" ")) {
        ends[ends.length - 1] = offset + cluster.length;
        continue;
      }
      text += value;
      for (let i = 0; i < value.length; i += 1) { starts.push(offset); ends.push(offset + cluster.length); }
    }
  }
  return { text, starts, ends };
}

/** Only quote typography, NFKC and whitespace normalization are permitted. */
export function clauseOffsets(rules: string, quote: string): { start: number; end: number } | null {
  const source = normalizedWithOffsets(rules);
  const needle = normalizedWithOffsets(quote).text.trim();
  if (!needle) return null;
  const index = source.text.indexOf(needle);
  return index < 0 ? null : { start: source.starts[index]!, end: source.ends[index + needle.length - 1]! };
}

export function formatTime(iso: string | number, zone = "UTC", seconds = false): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  if (seconds) options.second = "2-digit";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(iso));
}

/** Currency addresses are preserved. Only known Polygon USDC gets decimals. */
export function amount(value: string | null, currency: string | null): string | null {
  if (!value) return null;
  if (currency && ["0x2791bca1f2de4661ed88a30c99a7a9449aa84174", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"].includes(currency.toLowerCase())) {
    return `${(Number(value) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;
  }
  return `${value} base units (${currency?.slice(0, 8) ?? "currency unknown"})`;
}
