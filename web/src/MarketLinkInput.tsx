import { useEffect, useState } from "react";
import { loadExamples } from "./example-utils";
import type { ExampleLink } from "../../src/demo/example-links";

/** Shared link entry; both pages use the same current example links and resolver. */
export function MarketLinkInput({ url, onChange, onResolve, busy = false, home = false }: {
  url: string; onChange: (value: string) => void; onResolve: (value: string) => void; busy?: boolean; home?: boolean;
}) {
  const [examples, setExamples] = useState<ExampleLink[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    loadExamples(fetch, controller.signal).then((rows) => { if (!controller.signal.aborted) setExamples(rows); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const id = home ? "home-market-url" : "market-url";
  return <form className={`market-intake${home ? " hero-intake" : " panel"}`} onSubmit={(event) => { event.preventDefault(); onResolve(url); }}>
    <label htmlFor={id}>Paste a Polymarket link</label>
    <div className="url-row"><input id={id} type="url" required value={url} disabled={busy} onChange={(event) => onChange(event.target.value)} placeholder="https://polymarket.com/event/…" autoComplete="url" /><button className="button primary" disabled={busy}>{busy ? "Loading markets…" : home ? "Check timing →" : "Find markets →"}</button></div>
    {examples.length > 0 && <div className="example-chips"><span className="example-label">Try one</span>{examples.map((example) => <button key={example.url} type="button" className="button small-button" disabled={busy} title={`${example.url} — ${example.note}`} aria-label={`${example.label}: ${example.url}`} onClick={() => onResolve(example.url)}>{example.label}<span aria-hidden="true">↗</span></button>)}</div>}
  </form>;
}
