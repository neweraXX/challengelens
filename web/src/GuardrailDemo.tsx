import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { SealedEvidence } from "../../src/demo/types";
import { guardrailCounts, guardrailFrame, guardrailSchedule } from "./guardrail-utils";
import type { GuardrailCounts } from "./guardrail-utils";

export function GuardrailDemo({ runs }: { runs: SealedEvidence[] }) {
  const counts = guardrailCounts(runs);
  return counts ? <GuardrailStrip key={JSON.stringify(counts)} counts={counts} /> : null;
}

function GuardrailStrip({ counts }: { counts: GuardrailCounts }) {
  const schedule = guardrailSchedule(counts.total);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [elapsed, setElapsed] = useState(reduced ? schedule.duration : 0);
  const clock = useRef(elapsed);
  const [paused, setPaused] = useState(false); const [replay, setReplay] = useState(0);
  function seek(value: number) { clock.current = value; setElapsed(value); }
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setReduced(query.matches); if (query.matches) { seek(schedule.duration); setPaused(false); } };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [schedule.duration]);
  useEffect(() => {
    if (paused || reduced || clock.current >= schedule.duration) return;
    let previous = performance.now(); let request = 0;
    const step = (now: number) => {
      const value = Math.min(schedule.duration, clock.current + now - previous); previous = now;
      clock.current = value; setElapsed(value);
      if (value < schedule.duration) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [paused, reduced, replay, schedule.duration]);
  const frame = guardrailFrame(counts, elapsed);
  const jump = (checked: boolean) => { setPaused(true); seek(checked ? schedule.duration : schedule.stampEnd); };
  const restart = () => { seek(0); setPaused(false); setReplay((value) => value + 1); };
  const label = `Blind test on ${counts.total} proposals UMA judged too early. SERV alone approved ${counts.aloneApproved} of them too early. With deterministic checks, ${counts.checkedApproved} were approved too early. The second key holds proposals for evidence.`;
  return <section className="panel guardrail-demo" aria-label={label}>
    <div className="explainer-heading"><h2>What the second key changes</h2><div className="explainer-controls guardrail-motion-controls"><button className="text-button" aria-pressed={paused} onClick={() => frame.done ? restart() : setPaused(!paused)}>{paused || frame.done ? "Play" : "Pause"}</button><button className="text-button" onClick={restart}>Replay ↻</button></div></div>
    <div className="guardrail-toolbar"><div className="guardrail-toggle" role="group" aria-label="Compare the two arms"><button aria-pressed={!frame.checking} onClick={() => jump(false)}>SERV alone</button><button aria-pressed={frame.checking} onClick={() => jump(true)}>+ checks</button></div><div className="guardrail-counter" aria-hidden="true"><strong>{frame.approved} <span>of {counts.total}</span></strong><span>approved too early</span></div></div>
    <div className="guardrail-stage" aria-hidden="true" style={{ "--elapsed": `${elapsed}ms`, "--columns": Math.min(14, counts.total) } as CSSProperties}>
      <div className="guardrail-phase">{frame.checking ? "+ deterministic checks" : "SERV alone"}</div>
      <div className="guardrail-tiles">{Array.from({ length: counts.total }, (_, index) => {
        const approved = index < frame.approved;
        const held = frame.checking && !approved && index < counts.aloneApproved;
        const stampAt = approved ? schedule.entryEnd + (index + .5) / Math.max(1, counts.aloneApproved) * 700
          : schedule.checkStart + (counts.aloneApproved - index - .5) / Math.max(1, counts.aloneApproved - counts.checkedApproved) * 850;
        return <div key={index} className="guardrail-tile" data-state={approved ? "approved" : held ? "held" : "pending"} style={{ "--tile-delay": `${index * schedule.staggerMs}ms`, "--stamp-at": `${stampAt}ms` } as CSSProperties} title={approved ? "Approved too early" : held ? "Held for evidence" : "Proposal judged too early by UMA"}>
          {approved ? <span className="guardrail-stamp">✕<small>Approved<br />too early</small></span> : held ? <span className="guardrail-stamp"><svg width="18" height="20" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 2l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V5zM6 10l3 3 5-6" /></svg><small>Held</small></span> : <span className="guardrail-paper">≡</span>}
        </div>;
      })}</div>
      <div className="guardrail-gate" style={{ left: `${frame.gateProgress * 100}%`, opacity: frame.checking && !frame.done ? 1 : 0 }} />
      <p className="guardrail-legend">◷ Too early · <span>✕ approved too early</span> · <span>− held for evidence</span></p>
    </div>
    <p className="guardrail-caption">Same proposals, same SERV readings. The second key holds them for evidence.</p>
    <p className="small muted guardrail-note">Blind test on unseen cases (n = {counts.total} proposals judged too early by UMA); upper 95% bound for the checked arm: {(counts.intervalHigh * 100).toFixed(1)}% (case-level Wilson).</p>
  </section>;
}
