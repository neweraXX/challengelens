import { eventMarker, inputsAt } from "../../src/demo/evidence";
import { evaluateGate } from "../../src/gate/decide";
import { useId } from "react";
import type { ShowcaseCase } from "../../src/demo/types";
import { formatTime, linearScale } from "../../src/demo/math";

export function MiniTimeline({ item }: { item: ShowcaseCase }) {
  const pattern = `mini-${useId().replace(/:/gu, "")}`;
  const proposal = Date.parse(item.proposal_time_utc);
  const gate = evaluateGate(inputsAt(item, item.proposal_time_utc), item.verdict).gate;
  const event = eventMarker(item);
  const verified = Boolean(event) || gate.template !== "sports" && gate.agreement === "AGREE";
  const clocks = [gate.code_cutoff_utc, gate.serv_decisive_time_utc].filter((v): v is string => v !== null).map(Date.parse);
  const cutoff = event ? Date.parse(event.time) : clocks.length ? Math.max(...clocks) : null;
  const span = cutoff === null ? 3_600_000 : Math.max(60_000, Math.abs(cutoff - proposal));
  const min = Math.min(proposal, cutoff ?? proposal) - span * .18;
  const max = Math.max(proposal, cutoff ?? proposal) + span * .18;
  const scale = linearScale([min, max], [10, 290]);
  const boundary = cutoff === null ? 290 : scale.map(cutoff);
  const evidence = item.early_needs_evidence && !event || cutoff === null;
  return <svg className="mini-timeline" viewBox="0 0 300 36" role="img" aria-label={`Proposal ${formatTime(proposal)} UTC; ${cutoff === null ? "cutoff unavailable" : `decisive time ${formatTime(cutoff)} UTC`}`}>
    <defs><pattern id={pattern} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" x2="0" y1="0" y2="8" className="hatch-line" /></pattern></defs>
    <rect x="10" y="10" width={boundary - 10} height="16" className={evidence ? "zone-evidence" : "zone-early"} />
    {!evidence && <rect x="10" y="10" width={boundary - 10} height="16" fill={`url(#${pattern})`} />}
    {cutoff !== null && <><rect x={boundary} y="10" width={290 - boundary} height="16" className={verified ? "zone-decidable" : "zone-evidence"} /><line x1={boundary} x2={boundary} y1="6" y2="30" className="mini-decisive"><title>{event?.label ?? "Code cutoff"}</title></line></>}
    <line x1={scale.map(proposal)} x2={scale.map(proposal)} y1="3" y2="33" className="mini-proposal"><title>Actual proposal time</title></line>
  </svg>;
}
