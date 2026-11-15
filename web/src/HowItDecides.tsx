import { useId, useState } from "react";
import type { CSSProperties } from "react";
import type { ShowcaseCase } from "../../src/demo/types";
import { humanAction } from "../../src/demo/evidence";
import { explainerData } from "./live-utils";

export function HowItDecides({ item }: { item?: ShowcaseCase }) {
  const data = explainerData(item);
  const [replay, setReplay] = useState(0); const [paused, setPaused] = useState(false);
  const hatch = useId().replace(/:/gu, "");
  const action = humanAction(data.action);
  function bar(event: boolean) {
    const edge = (event ? data.eventPosition : data.codePosition) ?? 12;
    return <svg viewBox="0 0 300 58" aria-hidden="true" className="explainer-bar">
      <defs><pattern id={`${hatch}-${event}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" x2="0" y2="7" className="hatch-line" /></pattern></defs>
      <rect x="12" y="14" width="276" height="18" fill="var(--evidence-bg)" />
      <rect x="12" y="14" width={Math.max(0, edge * 3 - 12)} height="18" fill={`url(#${hatch}-${event})`} />
      {data.codePosition !== null && <g className="explainer-code-mark"><line x1={data.codePosition * 3} x2={data.codePosition * 3} y1="10" y2="36" stroke="var(--brand)" strokeWidth="2" /></g>}
      {event && data.eventPosition !== null && <g className="explainer-fact"><path d={`M${data.eventPosition * 3 - 4} 9l4 4 7-9`} fill="none" stroke="var(--teal)" strokeWidth="2" /><line x1={data.eventPosition * 3} x2={data.eventPosition * 3} y1="14" y2="36" stroke="var(--teal)" strokeWidth="2" /></g>}
      {event && data.proposalPosition !== null && <g className="explainer-proposal"><path d={`M${data.proposalPosition * 3 - 5} 4h10l-5 8z`} fill="var(--ink)" /><line x1={data.proposalPosition * 3} x2={data.proposalPosition * 3} y1="11" y2="34" stroke="var(--ink)" strokeWidth="2" /></g>}
      <text x="12" y="51" fontSize="11">{event ? `Proposal · ${data.proposalClock}` : "/// Too early"}</text>
    </svg>;
  }
  const summary = `How it decides, using ${data.title}. SERV reads “${data.quote}”: ${data.localClock}, converted to ${data.utcReading}. Code checks ${data.codeLabel.toLowerCase()} at ${data.codeClock}. ${data.fact}. Proposal at ${data.proposalClock}. Saved action: ${action}. ${data.reason}.`;
  return <section className="panel explainer" aria-label={summary}>
    <div className="explainer-heading"><div><h2>How it decides</h2><p>{data.title} <span className="muted">· one proposal, three checks</span></p></div><div className="explainer-controls"><button className="text-button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Play" : "Pause"}</button><button className="text-button" onClick={() => { setReplay(replay + 1); setPaused(false); }}>Replay ↻</button></div></div>
    <div key={`${item?.case_id ?? "empty"}-${replay}`} className="explainer-strip" data-paused={paused || undefined}>
      <div className="explainer-steps">
        <article className="explainer-step" tabIndex={0} style={{ "--stage": "0s" } as CSSProperties}><h3><span>01</span> SERV reads the rule</h3><div className="explainer-scene"><blockquote><span className="explainer-rule">“{data.quote}”</span></blockquote><p className="explainer-clock">{data.localClock} <span aria-hidden="true">→</span> {data.utcReading}</p></div><p className="explainer-caption">Read the clause and its local clock.</p></article>
        <article className="explainer-step" tabIndex={0} style={{ "--stage": "2.25s" } as CSSProperties}><h3><span>02</span> Code computes the clock</h3><div className="explainer-scene">{bar(false)}<p className="explainer-code-mark">{data.codeLabel} · {data.codeClock}<small>{data.codePosition === null ? "No supported clock recorded" : "Computed in code"}</small></p></div><p className="explainer-caption">{data.codeCaption}</p></article>
        <article className="explainer-step" tabIndex={0} style={{ "--stage": "4.5s" } as CSSProperties}><h3><span>03</span> Evidence checks the event</h3><div className="explainer-scene">{bar(true)}<p className="explainer-fact">{data.fact}</p></div><p className="explainer-caption">Check what happened before this proposal.</p></article>
      </div>
      <div className="explainer-result" tabIndex={0} style={{ "--stage": "6.75s" } as CSSProperties}><span className="explainer-before">Unchecked <span aria-hidden="true">→</span></span><div className="explainer-answer"><span className="explainer-pending" aria-hidden="true">Checking the timing…</span><div className="explainer-verdict"><span className="desk-chip" data-action={data.action}>{action}</span><p>{data.reason}</p></div></div></div>
    </div>
  </section>;
}
