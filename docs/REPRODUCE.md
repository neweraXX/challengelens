# Reproduce ChallengeLens

Run these Docker commands from the repository root. This guide distinguishes saved, offline replay from fresh public-data requests and paid inference. No host Node installation is required. The image build needs package-download access; later offline services explicitly disable networking.

Run these commands in your own environment with Docker. The held-out packets are not published, so the sealed-evaluation steps are documented but cannot be re-run from this repository.

## 1. Build

```sh
dc() { docker compose -f compose.web.yml "$@"; }
mkdir -p node_modules web/node_modules web/dist .cache/live .cache/evidence .cache/receipts   # bind-mount points on a fresh clone
dc build offline
```

`compose.web.yml` services share `challengelens-web:local`, built with `Dockerfile.web`. `Dockerfile.deploy` is the separate hosting image. No keys are needed to build. Do not run `lockfiles` as a reproduction step; it is a dependency-maintenance service.

## 2. Offline tests — no keys

```sh
dc run --rm offline
```

The service runs app typechecking, unit tests, web tests and a web build with `network_mode: none`. It writes generated web artifacts and throwaway test receipts, with sources mounted read-only. It makes zero inference calls. See the service's command in `compose.web.yml` for the exact test list.

## 3. Build the web bundle

```sh
dc run --rm web-build
```

No keys or network. Output: `web/dist`. Optional `CHALLENGELENS_REPO_URL` supplies the build-time repository link. Rebuild after regenerating public benchmark/showcase artifacts.

## 4. Run the app

```sh
LIVE_DESK=0 dc up app
```

Open `http://localhost:8080`. Leave this terminal running and use a second terminal for later commands, defining `dc` there too. Stop with Ctrl-C before switching modes.

`LIVE_DESK=0` prevents background live collection. Saved replay and published benchmark pages need no credentials. Pasted-market resolution and evidence gathering need public network access; supported, uncached fresh rule readings need `SERV_API_KEY`. No OpenRouter key is needed by the app.

To enable background collection later, with credentials already exported in your shell:

```sh
LIVE_DESK=1 dc up app
```

The default interval is 180000 ms, at most 25 SERV selections per cycle with a routine sample of 10. These are budgets, not promised call counts: cache hits and unsupported inputs can reduce inference. The deterministic desk screen can run without SERV, but no new SERV-confirmed actions are available then. For one cycle while `app` is stopped:

```sh
dc run --rm live-once
```

Live collection covers known Polymarket requesters, paginates up to 800 rows across two deployments, and reports freshness/truncation. Sleeping free hosting cannot screen continuously. `GET /api/live` reads the saved snapshot and itself makes zero inference calls.

## 5. Replay without keys

1. Open `http://localhost:8080/` for How it decides.
2. Open `http://localhost:8080/cases/timing-1cb1c22e47ea5596f03eb22a` for Braves vs. Nationals.
3. Drag the proposal across the final mark: **2025-09-17T03:36:14.500Z**. The label identifies the local preview. Dragging runs local logic with the saved SERV reading and makes zero network/model calls; it creates no new receipt.
4. Inspect the saved rule quote, evidence and receipt. Use `http://localhost:8080/benchmark` for published aggregates.

A fresh SERV re-check is a separate operation requiring `SERV_API_KEY`, normally one inference call on a cache miss. Moving the pin alone cannot be presented as a new SERV judgment. Missing required evidence may still prevent Proceed after a clock has passed.

## 6. Regate and rebuild the benchmark from saved runs

These services have no network and make **zero inference calls**. They reuse saved model responses. The development runs named below ship in `eval/runs/`:

```sh
dc run --rm regate eval/runs/pilot-2026-11-14T00-58-16-576Z --with-evidence
dc run --rm regate eval/runs/pilot-2026-11-13T13-54-20-572Z --with-evidence
dc run --rm benchmark eval/runs/pilot-2026-11-14T00-58-16-576Z eval/runs/pilot-2026-11-13T13-54-20-572Z
dc run --rm reppo-loop
dc run --rm web-build
```

Regating writes `gated-results.json` and `regated-report.md` in each selected run. `--with-evidence` uses run-local evidence, falling back to development evidence; recomputed evidence may differ from what the saved responses originally saw. This is not fresh timing-v8 inference or a blind test. Omitting that flag instead produces a gate view without evidence, overwriting the prior regated view.

`benchmark` publishes development reports under `web/public/data/`; it does not rerun or revise blind-test inference. `reppo-loop` publishes the saved critique/change record without contacting Reppo. If saved runs are absent, the shipped public aggregates remain viewable; do not substitute a holdout path into `regate`.

## 7. Collect evidence; optionally run fresh development inference

Public evidence collection needs network but no inference keys:

```sh
EVIDENCE_SPLIT=dev dc run --rm evidence dev
```

Only on a machine unable to reach Polymarket directly, supply the existing `POLYMARKET_PROXY` environment variable to the same command. Leave it unset where direct access works. Never put proxy credentials in a command or committed file. Binance evidence is fetched directly. Sports evidence uses identity-checked Gamma lookups; unsupported cases abstain.

Per supported price packet, the scanner allows at most 40 public HTTP requests, including hourly scan and 1-minute detail. Sports packets use at most two logical Gamma lookups, with HTTP retries possible. Caches can reduce requests to zero. Evidence collection itself makes **zero model calls**.

Optional fresh development run, with `SERV_API_KEY` already exported:

```sh
PILOT_ARMS=serv dc run --rm pilot-eval
```

The pilot plans 15 cases × 3 = **45 SERV calls**. To run both arms, also export `OPENROUTER_API_KEY`:

```sh
RAW_MODEL=google/gemini-3.1-flash-lite PILOT_ARMS=raw,serv dc run --rm pilot-eval
```

Both arms plan **45 raw + 45 SERV calls**. Compose otherwise defaults raw to `google/gemini-3.6-flash`; the reported blind tests used `google/gemini-3.1-flash-lite`. Record actual model IDs; a different model is a different experiment. There may be one explicit unsupported-schema fallback per arm; authentication or quota failure may stop it early. Checks-only adds zero calls. Fresh development inference does not reproduce an earlier stochastic output exactly.

Optional showcase refresh, after stopping the app:

```sh
dc run --rm infer
dc run --rm web-build
```

`infer` needs SERV and public-data access: up to 12 fresh strict-schema SERV calls, fewer on cache hits. It is unnecessary for viewing shipped replay data. It is not a blind evaluation.

## 8. Sealed evaluation — one-shot, restricted to the dataset custodian

**Do not run this as a routine demo or test.** Holdout packets, labels and private evaluation artifacts are withheld to preserve blindness. Public reproduction uses aggregate `web/public/data/sealed.json`. Do not inspect or reconstruct holdout cases from the demo.

The evaluator reserves a procedure fingerprint once per split, before inference. A failed or interrupted reservation remains consumed: **do not delete the reservation or retry the same one-shot run**. A later procedure evaluated on an exposed split is a second look, not another blind test. The timing-v8 evaluation already reported for blind test 2 must not be rerun as a new blind claim.

For a custodian with an authorized, unconsumed split, frozen source and keys, the sequence is public evidence collection, one-shot evaluation, aggregate publication, web build. The following is a template for that separate environment, not an instruction to rerun the existing submission:

```sh
# Only for an authorized, unconsumed sealed2 reservation and its private dataset.
EVIDENCE_SPLIT=sealed2 dc run --rm evidence sealed2
RAW_MODEL=google/gemini-3.1-flash-lite \
SEALED_SPLIT=sealed2 SEALED_ARMS=raw,serv \
SEALED_CONFIRM=4e2d3341383fcdd4b10d2be4a45225a8a95bbf92ee20d7bc0e585efbccd9260f \
dc run --rm sealed-eval
SEALED_SPLIT=sealed2 dc run --rm sealed-publish
dc run --rm web-build
```

`SEALED_CONFIRM` must equal the fingerprint of the actual frozen procedure, not a copied value after editing it. The shown fingerprint is timing-v8. `freeze.json` records procedure/gate/model identity and blind status; the evaluator's config records packet/label file fingerprints. The publisher carries procedure fingerprints into aggregate `sealed.json`. The private records were not inspected for this documentation.

With both arms, N cases × 3 readings plans **3N raw + 3N SERV calls**: 180 total for 30 cases, 360 for 60. `sealed2` requires both arms. At most one format fallback per provider can add two HTTP attempts in total; checks-only adds none. Evidence collection and aggregate publication make zero inference calls. Reppo is not called during sealed evaluation.

Blind test 2 completed 360/360 calls with one format-invalid SERV output, so status is `incomplete`. The raw-model recorded cost was about $0.22; SERV cost is not reported by the API. Case-majority counts and Wilson intervals treat the case as the sample unit, not each repeated call.

## 9. Optional Reppo review and credential summary

To review saved development verdicts, with `REPPO_API_KEY` already exported:

```sh
dc run --rm reppo-dev eval/runs/pilot-2026-11-14T00-58-16-576Z --max 6
```

This submits at most six evaluator tasks for selected saved dev verdicts, reuses matching saved evaluations and polls for completion. It makes zero SERV calls. HTTP polling can exceed the task count. App second opinions submit one task per newly reviewed receipt; `REPPO_DAILY_CAP=30` limits app submissions, not this explicit dev batch. A block/reject or route-review score <70 can only hold Proceed. A review never upgrades an action.

| Step / service | Credential | Approximate inference or evaluator budget |
| --- | --- | --- |
| Build, `offline`, `web-build`, replay drag, `regate`, `benchmark`, `reppo-loop` | None | 0 |
| `evidence` | No API key; optional reachability proxy | 0 inference; public HTTP budgets above |
| `app` fresh supported check / replay re-check | `SERV_API_KEY` | Normally 1 uncached SERV call per check |
| `live-once` / background desk | `SERV_API_KEY` for SERV readings | Up to 25 selections/cycle by default; cache may reduce calls |
| `infer` | `SERV_API_KEY` | Up to 12 SERV calls |
| `pilot-eval` | `SERV_API_KEY`; `OPENROUTER_API_KEY` for raw | 45 per selected arm, plus possible format fallback |
| `sealed-eval` | Both keys for `sealed2` | 3N per arm; one-shot rules apply |
| `sealed-publish` | None | 0 |
| `reppo-dev` / app second opinions | `REPPO_API_KEY` | Up to 6 tasks in shown batch / 1 per new reviewed receipt |

Keep keys in the shell or hosting dashboard. No credentials are required for the published aggregate evidence. Timing checks are not financial advice; the project is independent of Polymarket, UMA, OpenServ and Reppo.
