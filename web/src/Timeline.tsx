import { useEffect, useId, useRef, useState } from "react";
import type { ShowcaseCase } from "../../src/demo/types";
import { clamp, formatTime, linearScale, snapMinute } from "../../src/demo/math";
import { eventMarker, inputsAt } from "../../src/demo/evidence";
import { evaluateGate } from "../../src/gate/decide";
import type { Gate } from "../../src/gate/decide";
import { axisTicks, durationText, rescheduleCallout, timelineDomain } from "./timeline-utils";

interface Props {
  item: ShowcaseCase;
  gate?: Gate;
  time: number;
  cutoff: string | null;
  earlyNeedsEvidence: boolean;
  reveal: boolean;
  onChange: (time: number) => void;
}
interface Marker { label: string; time: number; kind: string }

export function Timeline({ item, time, cutoff, earlyNeedsEvidence, reveal, onChange, gate: suppliedGate }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(900);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const hatch = useId().replace(/:/gu, "");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(240, entry.contentRect.width)); });
    if (container.current) observer.observe(container.current);
    return () => { query.removeEventListener("change", update); observer.disconnect(); };
  }, []);

  const gate = suppliedGate ?? evaluateGate(inputsAt(item, new Date(time).toISOString()), item.verdict).gate;
  const sports = gate.template === "sports";
  const event = eventMarker(item);
  const verified = Boolean(event) || !sports && gate.agreement === "AGREE";
  const original = Date.parse(item.proposal_time_utc);
  const independent = gate.code_cutoff_utc ? Date.parse(gate.code_cutoff_utc) : null;
  const serv = gate.serv_decisive_time_utc ? Date.parse(gate.serv_decisive_time_utc) : null;
  const shownCutoff = event?.time ?? (sports ? gate.sports?.estimated_end_utc ?? null : independent !== null && serv !== null ? new Date(Math.max(independent, serv)).toISOString() : cutoff);
  const decisive = shownCutoff ? Date.parse(shownCutoff) : null;
  const rules = item.rules_time_utc ? Date.parse(item.rules_time_utc) : null;
  const gamma = item.gamma_time_utc ? Date.parse(item.gamma_time_utc) : null;
  const dispute = item.dispute_time_utc ? Date.parse(item.dispute_time_utc) : null;
  const settlement = reveal && item.settlement_time_utc ? Date.parse(item.settlement_time_utc) : null;
  const [start, end] = timelineDomain([original, decisive, rules, gamma, dispute]);
  const left = 24;
  const right = width - 24;
  const scale = linearScale([start, end], [left, right]);
  const x = (value: number) => clamp(scale.map(value), left, right);
  const decisiveX = decisive === null ? right : x(decisive);
  const proposalX = x(time);
  const barTop = 48;
  const barEnd = barTop + 76;
  const needsEvidence = decisive === null || earlyNeedsEvidence && !event;
  const estimate = sports && !event ? gate.notes.join(" ") : null;
  const changed = gamma !== null && rules !== null && gamma !== rules;
  const callout = rescheduleCallout({ ...item, decisive_time_utc: event ? null : shownCutoff, sports });
  const markers: Marker[] = [];
  if (rules !== null) markers.push({ label: item.fixed_time_kind === "sports_scheduled" ? "Rules · scheduled start" : "Rules · observation clock", time: rules, kind: "rules" });
  if (gamma !== null && (changed || rules === null)) markers.push({ label: changed ? `Gamma · Rescheduled ${gamma > rules! ? "+" : "−"}${durationText(gamma - rules!)}` : "Gamma · current schedule", time: gamma, kind: "gamma" });
  if (decisive !== null) markers.push({ label: event?.label ?? `Gate · ${sports ? "Estimated end, unverified" : "Both cutoffs"}${estimate ? ` (${estimate})` : ""}`, time: decisive, kind: "decisive" });
  const details = [...markers, { label: "Proposal · selected time", time, kind: "proposal" }];
  if (dispute !== null) details.push({ label: "Dispute", time: dispute, kind: "dispute" });
  if (settlement !== null) details.push({ label: `Settlement${settlement > end ? " · later than this window" : ""}`, time: settlement, kind: "settlement" });
  const ticks = axisTicks(start, end, compact ? 2 : 5);
  const minimum = Math.ceil(start / 60_000) * 60_000;
  const maximum = Math.floor(end / 60_000) * 60_000;
  function change(value: number) { onChange(clamp(snapMinute(value), minimum, maximum)); }
  function move(clientX: number) {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return;
    const point = element.createSVGPoint();
    point.x = clientX;
    change(scale.invert(point.matrixTransform(matrix.inverse()).x));
  }
  function tooltip(value: number) { return `${formatTime(value)} UTC · ${formatTime(value, "America/New_York")} ET`; }
  function focusRule() {
    const clause = document.getElementById("governing-clause");
    clause?.focus(); clause?.scrollIntoView({ block: "center" });
  }

  const pinBoxX = clamp(proposalX - 47, 6, width - 100);
  return <div className="timeline-content" ref={container}>
    {callout && <details className="reschedule-callout"><summary>Schedule changed · current Gamma start used</summary><p>{callout}</p></details>}
    <div className="timeline-frame">
      <svg ref={svg} viewBox={`0 0 ${width} 176`} className={`timeline${compact ? " compact" : ""}`} role="group" aria-label="Proposal timeline. UTC axis; marker details include Eastern Time.">
        <defs><pattern id={hatch} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" x2="0" y1="0" y2="10" className="hatch-line" /></pattern></defs>
        <rect x={left} y={barTop} width={decisiveX - left} height="76" className={needsEvidence ? "zone-evidence" : "zone-early"} />
        {!needsEvidence && <rect x={left} y={barTop} width={decisiveX - left} height="76" fill={`url(#${hatch})`} />}
        {decisive !== null && <rect x={decisiveX} y={barTop} width={right - decisiveX} height="76" className={verified ? "zone-decidable" : sports ? "zone-unverified" : "zone-evidence"} />}
        <text x={left} y={barTop - 12} className="zone-label">{needsEvidence ? "? Needs evidence" : "/// Too early"}</text>
        {decisive !== null && <text x={right} y={barTop - 12} textAnchor="end" className="zone-label">{event ? "Evidence observed" : sports ? <><tspan x={right} dy="-5">Estimated end</tspan><tspan x={right} dy="14">unverified</tspan></> : verified ? "Code cutoff passed" : compact ? "Unverified" : "? Needs evidence"}</text>}
        {markers.map((marker) => <g className={`time-marker ${marker.kind}-marker`} key={marker.kind}><title>{marker.label}: {tooltip(marker.time)}</title><line x1={x(marker.time)} x2={x(marker.time)} y1="44" y2={barEnd} /><circle cx={x(marker.time)} cy="44" r="3" /></g>)}
        <line x1={left} x2={right} y1={barEnd} y2={barEnd} className="axis-line" />
        {decisive !== null && <line x1={decisiveX} x2={decisiveX} y1={barTop} y2={barEnd} className="cutoff-line"><title>Decisive time: {tooltip(decisive)}</title></line>}

        {ticks.map((tick, index) => <g key={tick.time} className="axis-tick"><title>{tooltip(tick.time)}</title><line x1={scale.map(tick.time)} x2={scale.map(tick.time)} y1={barEnd} y2={barEnd + 6} /><text x={scale.map(tick.time)} y={147} textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}>{tick.label}</text></g>)}
        <text x={right} y={169} textAnchor="end" className="axis-unit">UTC</text>
        <g className="proposal-pin" role="slider" tabIndex={0} aria-label="Proposal time" aria-orientation="horizontal" aria-valuemin={minimum / 60_000} aria-valuemax={maximum / 60_000} aria-valuenow={time / 60_000} aria-valuetext={tooltip(time)}
          onKeyDown={(event) => {
            const step = (event.shiftKey ? 15 : 1) * 60_000;
            if (["ArrowRight", "ArrowUp"].includes(event.key)) { event.preventDefault(); change(time + step); }
            if (["ArrowLeft", "ArrowDown"].includes(event.key)) { event.preventDefault(); change(time - step); }
            if (event.key === "Home") { event.preventDefault(); change(minimum); }
            if (event.key === "End") { event.preventDefault(); change(maximum); }
          }}
          onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); move(event.clientX); }}
          onPointerMove={(event) => { if (dragging.current) move(event.clientX); }}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
          <title>Proposal. Drag or use arrow keys to move by a minute.</title>
          <line x1={proposalX} x2={proposalX} y1={barTop + 8} y2={barEnd} /><path d={`M${proposalX - 7} ${barTop + 8}h14l-7 10z`} />
          <rect x={pinBoxX} y={barTop + 30} width="94" height="32" rx="3" /><text x={pinBoxX + 47} y={barTop + 51} textAnchor="middle">↔ Proposal</text>
          <rect x={proposalX - 22} y={barTop} width="44" height="80" className="pin-hit-area" />
        </g>
      </svg>
    </div>
    {event && <p className="evidence-marker-label"><strong>{event.label}</strong><time dateTime={event.time}>{event.time}</time></p>}
    {compact && <div className="time-nudges" aria-label="Adjust proposal time"><button className="button small-button" disabled={time <= minimum} onClick={() => change(time - 15 * 60_000)}>−15m</button><span>Move the proposal</span><button className="button small-button" disabled={time >= maximum} onClick={() => change(time + 15 * 60_000)}>+15m</button></div>}
    {decisive === null && <p className="cutoff-missing">No usable gate cutoff was established.</p>}
    <details className="timeline-marker-details"><summary>Schedule and clock details</summary><dl className={`marker-list${compact ? " compact" : ""}`}>{details.map((marker) => <div key={marker.kind} className={`${marker.kind}-detail`}>
      <dt>{marker.kind === "rules" ? <button className="text-button" onClick={focusRule}>{marker.label} ↗</button> : marker.label}</dt>
      <dd><time dateTime={new Date(marker.time).toISOString()}>{formatTime(marker.time)} UTC</time><small>{formatTime(marker.time, "America/New_York")} ET</small></dd>
    </div>)}</dl></details>
  </div>;
}
