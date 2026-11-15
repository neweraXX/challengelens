/** Browser-safe example metadata and conservative checks for saved fallback links. */
export interface ExampleLink { label: string; url: string; kind: "crypto" | "sports" | "static"; note: string }
export interface ExampleResponse { generated_at: string; examples: ExampleLink[] }
export const EXAMPLE_MARGIN_MS = 20 * 60_000;
const months = "january february march april may june july august september october november december".split(" ");
export function cryptoExamples(now: number, asset: "bitcoin" | "ethereum"): ExampleLink[] {
  const date = new Date(now);
  return Array.from({ length: 3 }, (_, offset) => {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
    return { label: asset === "bitcoin" ? "Bitcoin price at a fixed time" : "Ethereum price at a fixed time",
      url: `https://polymarket.com/event/${asset}-above-on-${months[day.getUTCMonth()]}-${day.getUTCDate()}-${String(day.getUTCFullYear()).padStart(4, "0")}`,
      kind: "crypto", note: "An open market with a fixed-time price observation." };
  });
}
export function exampleLink(value: unknown, kind: ExampleLink["kind"] = "static"): ExampleLink | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 200 || typeof row.url !== "string" || row.url.length > 2048) return null;
  try {
    const url = new URL(row.url);
    if (url.protocol !== "https:" || !["polymarket.com", "www.polymarket.com"].includes(url.hostname) || url.port || url.username || url.password ||
      !/^\/(?:event\/[a-z0-9][a-z0-9-]{0,239}(?:\/[a-z0-9][a-z0-9-]{0,239})?|market\/[a-z0-9][a-z0-9-]{0,239})\/?$/u.test(url.pathname)) return null;
    return { label: row.label.trim(), url: `https://polymarket.com${url.pathname.replace(/\/$/u, "")}`, kind,
      note: typeof row.note === "string" ? row.note.slice(0, 300) : "A saved example; live availability could not be checked." };
  } catch { return null; }
}
function datedSlug(url: string): number | null {
  const slug = new URL(url).pathname.split("/")[2] ?? "";
  const crypto = slug.match(/^(?:bitcoin|ethereum)-above-on-([a-z]+)-(\d{1,2})-(\d{4})$/u);
  const sports = slug.match(/-(\d{4})-(\d{2})-(\d{2})$/u);
  const year = Number(crypto?.[3] ?? sports?.[1]);
  const month = crypto ? months.indexOf(crypto[1]!) + 1 : Number(sports?.[2]);
  const day = Number(crypto?.[2] ?? sports?.[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}
/** No Gamma calls: hide past dates and links whose freshness cannot be established locally. */
export function fallbackExamples(value: unknown, now = Date.now()): ExampleLink[] {
  if (!Array.isArray(value)) return [];
  const today = new Date(now); const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const out: ExampleLink[] = [];
  for (const row of value) {
    const link = exampleLink(row); if (!link || row.closed === true || row.active === false || out.some((r) => r.url === link.url)) continue;
    const end = typeof row.endDate === "string" ? Date.parse(row.endDate) : null;
    const day = datedSlug(link.url);
    if (end !== null ? !Number.isFinite(end) || end <= now + EXAMPLE_MARGIN_MS : day === null || day < midnight) continue;
    out.push(link); if (out.length === 3) break;
  }
  return out;
}
