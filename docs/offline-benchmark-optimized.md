# Synthetic offline benchmark: optimized candidate

**Historical byte-accounting caveat:** this run predates the cache-size normalization regression fix. Chromium reported some negative `responseBodySize` values for cache/SW accounting, so the recorded byte totals can be slightly understated. The historical artifacts are retained unchanged, not silently rewritten. CPU, timing, request and functional results are unaffected. Future runs clamp physical byte fields to zero and retain raw sizes plus anomaly markers.


**Status: functional/browser checks pass, but the required 52-order local-CPU gate still fails.** This report preserves the same measurement protocol as the initial run; no metric or baseline was changed to turn a failure into a pass.

## Verification and identity

- Candidate per-file/aggregate SHA-256: `8666b371c5907eb1a0645235e7a5356f2f261f2c74bda2f50ed8712d2b9e2653`.
- After the benchmark, the complete **15-case production Turbopack E2E suite passed in 47.5 seconds** using the exact same aggregate source hash. All source files matched the current worktree at final verification.
- Original Git revision: `e033d384a96265785c9329d2d910e1bf7b691623`.
- **48/48 samples**: one warmup plus five measured repetitions at 25, 52, 100 and 1,000 orders for both variants.
- Same scripts, Linux machine, locked dependencies, Chromium, loopback mock, and webpack compiler for both performance variants. The separate browser suite uses default Turbopack.
- Benchmark exit status **1**; E2E exit status **0**. All test services were stopped afterward.

## Medians

| Orders | Original local CPU ms | Candidate local CPU ms | Reduction / CPU gate | Original requests | Candidate requests | Original bytes | Candidate bytes | Original time ms | Candidate time ms |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 25 | 1,430 | 530 | 62.9%; no 80% gate | 59 | 21 | 279,555 | 101,184 | 1,765 | 1,318 |
| 52 | 2,390 | 550 | **77.0%; FAIL** | 117 | 21 | 543,380 | 112,287 | 2,261 | 1,285 |
| 100 | 4,090 | 540 | **86.8%; PASS** | 215 | 21 | 1,001,493 | 131,984 | 3,145 | 1,294 |
| 1,000 | 24,650* | 900 | Not equal completed work* | 1,427* | 21 | 6,813,417* | 501,884 | 13,831* | 1,392 |

Local CPU is the per-sample sum of the full Next process tree, mock HTTP process and full Chromium process tree. At 52 orders, component medians were Next 70 ms, Chromium 470 ms and mock 0 ms at 10 ms tick resolution; independently calculated component medians need not sum to the median total. Reaching the 80% gate against this baseline requires local CPU at most 478 ms, compared with the measured 550 ms.

The candidate improved absolute 52-order CPU from the initial run's 600 ms to 550 ms and reduced preparation requests from 24 to 21. The independently rerun original baseline was also faster, so the reduction percentage did not meet the gate. Do not combine a favorable baseline from one run with a candidate from another run.

For **every candidate measured repetition at all four sizes**:

- Zero automatic detail/ticket requests.
- Exactly one preparation snapshot.
- Zero snapshot downloads during a within-TTL revisit.
- Complete preparation, including all 1,000 orders.

### Original 1,000-order limitation

The original unbounded worker fan-out again exhausted Chromium request resources, so the original run did not prepare the full dataset. Median coverage was only **671/1,000 detail documents and 670/1,000 tickets**. Its consumed CPU/traffic/time are reported, but no equal-completed-work reduction claim is made. The 25-, 52- and 100-order baselines completed fully.

## Evidence and commands

All raw synthetic evidence is retained at `e2e/benchmark-results/optimized/`: `report.json`, `report.md`, all 48 samples, per-sample request/timing/byte logs, traces, harness metadata, and per-file source manifests. `e2e/results/` holds the final 15-case E2E report, source hash, traces, print PDF and screenshot. Generated artifacts remain git-ignored.

Commands executed:

```sh
node scripts/offline-benchmark.mjs --output=e2e/benchmark-results/optimized
npx playwright test
```

See `docs/offline-testing.md` for methodology and safety boundaries. `docs/offline-benchmark-results.md` preserves the preceding rejected run. Further performance changes require another separately identified benchmark and functional verification; **the approved CPU acceptance criterion has not yet been achieved**.
