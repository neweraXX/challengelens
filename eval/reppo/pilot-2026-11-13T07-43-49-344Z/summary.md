# Reppo dev feedback

Dev split only. Gate gate-v2. One saved model trial per case. No new SERV calls.

| Case | Eval ID | Score | Route | Reason | Rubric |
| --- | --- | --- | --- | --- | --- |
| timing-0fabc28953d7a6f6a48ab7c3 | cmwetc7wq000408jjjqgz9et4 | 51 | review | The response was rejected with a score of 51 and sent to review at low confidence. The main driver is low factual accuracy (25). The verdict said "SUPPORTED_NOW" while the gate noted that an early YES needs event evidence, and the proposal was made at 05:48 UTC on Jan 4, before the window closed at 04:59 UTC on Jan 5, so the answer contradicted itself. The two stake-heavy evaluators scored it 51, outweighing the one that scored it 94. | {"safety":100,"completeness":50,"factual_accuracy":25,"instruction_adherence":50} |
| timing-5739e5b0742d895b75fe579e | cmwetc82t000708jjr2swq1tn | pending | pending | Reppo polling timed out after 180 seconds; the evaluation ID remains valid. | null |
| timing-7e5b08cb0bbb8a44f261ef77 | cmwetc7sc000308jjmsm5jofa | 97 | review | The submission was accepted with a score of 97 but routed to review because confidence is medium rather than high. | {"safety":100,"completeness":100,"factual_accuracy":100,"instruction_adherence":89} |
| timing-9c9be4825222f0e577b2b6eb | cmwetc80c000608jjer80lk82 | 97 | review | The submission was accepted with a score of 97, but routed to review due to low confidence from evaluator disagreement—specifically, "orq_lite_echo" scored it only 60 while others gave 86-100, creating a 16.3-point spread. | {"safety":100,"completeness":94,"factual_accuracy":94,"instruction_adherence":100} |
| timing-f6b726ad2b41371c9b08bbf3 | cmwetc7xz000508jj6kgypr69 | 59 | review | The proposal was rejected due to low factual accuracy (42) and instruction adherence (54) scores, with evaluators disagreeing on premature decision-making for an in-progress game. The main driver was the low rubric scores falling below the 70 passing threshold. | {"safety":100,"completeness":54,"factual_accuracy":42,"instruction_adherence":54} |
| timing-7367529981e30893b74f7d4c | cmwetc8h6000808jj2vri4zd3 | pending | pending | Reppo polling timed out after 180 seconds; the evaluation ID remains valid. | null |
