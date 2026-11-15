export type SportsScope = "FULL_GAME_RESULT" | "FULL_GAME_THRESHOLD" | "PARTIAL_PERIOD" | "UNKNOWN";
export interface ScopeInput { title: string; rules_text: string; sportsMarketType?: string | undefined; proposed_outcome_label: string }

/** Read res_data labels without assuming Gamma's outcome ordering matches the oracle. */
export function proposedOutcomeLabel(rules: string, value: string): string {
  const target = value === "0" ? "1" : value === "1000000000000000000" ? "2" : null;
  if (!target) return "OTHER";
  const labels = [...rules.matchAll(/\bp([12])\s+(?:corresponds?\s+)?(?:to|is|:|=)\s*["“']?(.{1,120}?)(?=,|;|\n|\.(?:\s|$)|\bp[123]\s+(?:(?:corresponds?\s+)?to|:)|$)/giu)]
    .filter((m) => m[1] === target).map((m) => m[2]!.trim().replace(/["”']$/u, "").trim()).filter((s) => /[a-z]/iu.test(s));
  return new Set(labels).size === 1 ? labels[0]! : target === "1" ? "No" : "Yes";
}
export function thresholdSide(label: string): "REACHED" | "NOT_REACHED" | "UNKNOWN" {
  const yes = /\b(?:over|yes)\b/iu.test(label); const no = /\b(?:under|no)\b/iu.test(label);
  return yes !== no ? yes ? "REACHED" : "NOT_REACHED" : "UNKNOWN";
}

/** Full-game negatives require affirmative scope recognition; period markers always take priority. */
export function sportsScope(input: ScopeInput): SportsScope {
  const title = input.title.normalize("NFKC"); const rules = input.rules_text.normalize("NFKC");
  const type = (input.sportsMarketType ?? "").replaceAll("_", " ");
  const text = `${title} ${rules} ${type}`;
  if (/\b(?:[12]H|H[12]|[1-4]Q|Q[1-4]|[1-3]P)\b|\b(?:first|second|1st|2nd)[- ]+half\b|\b(?:half[- ]time|quarter|innings?)\b|\bperiod\s*(?:\d+|one|two|three)\b|\b(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+period\b|\b(?:set|map)\s*(?:\d+|one|two|three|four|five)\b|\b(?:first|second|third|1st|2nd|3rd)\s+(?:set|map)\b|\bgame\s+\d+(?:\s+of\s+(?:a|the)\s+series)?\b|\bfirst\s+\d+\s+minutes\b|\b(?:1st|first)\s+(?:\w+\s+)?(?:scorer|to score|goal|basket|touchdown)\b/iu.test(text)) return "PARTIAL_PERIOD";
  const threshold = /\bO\s*\/\s*U\b|\bover\s*\/\s*under\b|\b(?:over|under)\s+\d|\b(?:totals?|BTTS|both teams to score|points|rebounds|assists|threes|three[- ]pointers|strikeouts|shots|yards|touchdowns|goals|hits|runs|aces|double faults)\b/iu;
  if (/\b(?:player|props?)\b/iu.test(type) || threshold.test(`${title} ${type}`) || /\b(?:player|team)\s+totals?\b|\bboth teams (?:to |will )?score\b|\b(?:player|he|she)\s+(?:scores?|records?|makes?)\b|\b(?:at least|more than|less than)\s+\d/iu.test(rules)) return "FULL_GAME_THRESHOLD";
  if (/\b(?:coin toss|race to|next scorer|next goal|overtime only)\b/iu.test(text)) return "UNKNOWN";
  if (/\b(?:moneyline|match winner|game winner|full[- ]game spread|spreads?|draw)\b/iu.test(`${title} ${type}`) ||
      /\b(?:winner of|wins?)\b[^.;\n]{0,80}\b(?:game|match)\b|\b(?:game|match)\b[^.;\n]{0,80}\b(?:winner|wins?)\b/iu.test(rules) ||
      /\bvs\.?\s+[^:?!]+$/iu.test(title) && /\b(?:game|match)\b/iu.test(rules)) return "FULL_GAME_RESULT";
  if (threshold.test(rules)) return "FULL_GAME_THRESHOLD";
  return "UNKNOWN";
}
export function scopeFromInputs(inputs: { title: string; rules_text: string; proposed_value: string; gamma_scheduling: { market: Record<string, string> } }) {
  const proposed_outcome_label = proposedOutcomeLabel(inputs.rules_text, inputs.proposed_value);
  const sportsMarketType = inputs.gamma_scheduling.market.sportsMarketType;
  return { scope: sportsScope({ ...inputs, sportsMarketType, proposed_outcome_label }), proposed_outcome_label, sportsMarketType };
}
/** Shared gate/desk policy; a full-game feed says nothing about when a partial period ended. */
export function incompleteGame(scope: SportsScope, label: string) {
  if (scope === "FULL_GAME_RESULT") return { premature: true, need: "NEED_GAME_FINAL", reason: "game not finished at proposal time (sports feed)" } as const;
  if (scope === "FULL_GAME_THRESHOLD" && thresholdSide(label) === "NOT_REACHED") return { premature: true, need: "NEED_GAME_FINAL", reason: "needs the final result" } as const;
  if (scope === "FULL_GAME_THRESHOLD" && thresholdSide(label) === "REACHED") return { premature: false, need: "NEED_EVENT_OCCURRED", reason: "the line may already be crossed; verify the live score" } as const;
  return { premature: false, need: "NEED_PERIOD_FINAL", reason: "confirm the period this market covers has ended" } as const;
}
