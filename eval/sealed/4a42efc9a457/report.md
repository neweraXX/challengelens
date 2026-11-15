# Sealed evaluation

Procedure: timing-v5 / 4a42efc9a45737347dd7ecb75364294ae078d1f814818b81efd85dcc23af81fb; gate: gate-v2; status: incomplete.

Wilson 95% intervals use CASE-majority outcomes, not trials: the three repetitions are not independent. Outcome rates exclude cases without a decision majority (at least two valid decisions); these missing majorities are reported explicitly. Correct requires a majority matching both decision and reason. Consistency uses all planned cases and requires three valid matching decisions and reasons. False approvals use too-early cases with a decision majority. Gated rows reuse inference tokens and cost.

| Arm | Correct | False approvals on too-early | Abstentions | Consistency | Majority cases | Tokens | Recorded USD | Cost coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Model only | 13/27 (30.74–66.01%) | 5/12 (19.33–68.05%) | 6/27 (10.61–40.76%) | 20/30 (48.78–80.77%) | 27/30 | 267472 | 0.08969175 | 90/90 complete |
| Model + code key | 12/27 (27.59–62.69%) | 0/12 (0.00–24.25%) | 13/27 (30.74–66.01%) | 24/30 (62.69–90.49%) | 27/30 | 267472 | 0.08969175 | 90/90 complete |
| SERV | 12/30 (24.59–57.68%) | 9/15 (35.75–80.18%) | 7/30 (11.79–40.93%) | 22/30 (55.55–85.82%) | 30/30 | 137679 | 0.00000000 | 0/90 partial/unreported |
| SERV + code key | 15/30 (33.15–66.85%) | 0/15 (0.00–20.39%) | 13/30 (27.38–60.80%) | 30/30 (88.65–100.00%) | 30/30 | 137679 | 0.00000000 | 0/90 partial/unreported |
