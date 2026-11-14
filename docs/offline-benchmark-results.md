# Synthetic offline benchmark: initial integrated candidate

**Historical byte-accounting caveat:** this run predates the cache-size normalization regression fix. Chromium reported some negative `responseBodySize` values for cache/SW accounting, so the recorded byte totals can be slightly understated. The historical artifacts are retained unchanged, not silently rewritten. CPU, timing, request and functional results are unaffected. Future runs clamp physical byte fields to zero and retain raw sizes plus anomaly markers.


This is a recorded measurement, **not a claim that the CPU acceptance gate passed**. Subsequent optimizations must receive a new source manifest and fresh results; preserve this run as evidence.

## Protocol and source identity

- Original source: `e033d384a96265785c9329d2d910e1bf7b691623`, extracted into a disposable source tree without environment files.
- Candidate aggregate source SHA-256: `732edf0d0bdaf3821ff0db632126613e2fa2be4276cebbdb4101acff8f3e4d32`.
- Candidate per-file hashes include untracked implementation files and are recorded in `e2e/benchmark-results/final/candidate-sources.json`. At post-run verification, all candidate file hashes matched the implementation worktree.
- One warmup and five measured repetitions for each of 25, 52, 100 and 1,000 orders, both variants: **48 samples total**.
- Both variants used webpack, the same locked dependencies, the same real local mock HTTP server, and the same Chromium installation/machine.
- Full local CPU is Next process tree + mock HTTP process + full Chromium process tree, sampled from Linux `/proc` user/system ticks. Build/startup and revisit are outside preparation measurement.
- Functional acceptance separately runs the default production Turbopack build with real service workers.

## Measured medians

| Orders | Original local CPU ms | Candidate local CPU ms | Reduction | Original requests | Candidate requests | Original bytes | Candidate bytes | Original time ms | Candidate time ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 1,600 | 620 | 61.3% | 59 | 24 | 279,261 | 102,052 | 1,821 | 1,425 |
| 52 | 2,690 | 600 | **77.7% — FAIL** | 117 | 24 | 542,734 | 113,221 | 2,381 | 1,397 |
| 100 | 3,840 | 600 | **84.4% — PASS** | 215 | 24 | 1,000,213 | 132,851 | 3,048 | 1,396 |
| 1,000 | 25,470* | 960 | Not equal completed work* | 1,429* | 24 | 6,812,042* | 502,754 | 14,518* | 1,649 |

The required **at least 80% reduction at 52 orders was not met**. The benchmark exits nonzero for that failure. The 100-order CPU gate passed.

For every candidate repetition at every size:

- **0 automatic detail/ticket requests**.
- **1 initial snapshot request**.
- **0 snapshot requests on revisit within the TTL**.
- Full preparation completed, including all 1,000 orders in the largest dataset.

### Why the original 1,000-order row is not an equal-work comparison

The old worker launches an unbounded fan-out. Chromium recorded `net::ERR_INSUFFICIENT_RESOURCES` failures; one measured repetition recorded 655 of these. Across measured repetitions, median cached coverage was only **670/1,000 detail documents and 671/1,000 tickets**, with a median 658 failed requests. The table records the actual CPU/traffic/time consumed before requests settled, not a fictitious successful preparation of all 1,000 orders. No equal-work CPU-reduction claim is made for this size.

The original 25-, 52- and 100-order scenarios completed fully and had no failed requests.

## Evidence and reruns

Local synthetic evidence is under `e2e/benchmark-results/final/`:

- `report.json`, `report.md`: medians, acceptance gates and measurement definitions.
- `samples.json`: every warmup and measured sample, including CPU components and actual coverage.
- `manifest.json`, `*-sources.json`: machine/tool versions, harness and build-source fingerprints.
- `*-requests.json`: browser and worker request provenance, wire body bytes, timing, upstream mock payloads and failures.
- `*-trace.zip`: Chromium/Playwright traces for all 48 samples.

These generated artifacts are intentionally git-ignored. Only this synthetic summary and the reproducible harness are source artifacts. The benchmark reports upstream mock bytes separately rather than double-counting them in browser-network bytes. Individual CPU-component medians need not sum exactly to the median of per-sample local CPU totals.

See `docs/offline-testing.md` for methodology, environment isolation, cleanup guarantees and commands. If source changes, use a new output directory so a rejected result is not silently overwritten:

```sh
npx playwright test
node scripts/offline-benchmark.mjs --output=e2e/benchmark-results/optimized
```
