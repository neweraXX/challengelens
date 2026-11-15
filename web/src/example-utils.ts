import { exampleLink, fallbackExamples } from "../../src/demo/example-links.js";
import type { ExampleLink } from "../../src/demo/example-links.js";

/** A transport failure alone permits the saved fallback. HTTP errors and a successful
 * empty response hide the chips; they must not resurrect known-invalid examples. */
export async function loadExamples(fetcher: typeof fetch = fetch, signal?: AbortSignal, now = Date.now()): Promise<ExampleLink[]> {
  let response: Response;
  try { response = await fetcher("/api/examples", signal ? { signal } : {}); }
  catch (error) {
    if (signal?.aborted) throw error;
    try {
      const saved = await fetcher("/data/examples.json", signal ? { signal } : {});
      return saved.ok ? fallbackExamples(await saved.json(), now) : [];
    } catch { return []; }
  }
  if (!response.ok) return [];
  try {
    const payload = await response.json() as { examples?: unknown };
    if (!Array.isArray(payload?.examples)) return [];
    const out: ExampleLink[] = [];
    for (const row of payload.examples) {
      if (!row || !["crypto", "sports", "static"].includes(row.kind)) continue;
      const link = exampleLink(row, row.kind);
      if (link && !out.some((r) => r.url === link.url)) out.push(link);
      if (out.length === 3) break;
    }
    return out;
  } catch { return []; }
}
