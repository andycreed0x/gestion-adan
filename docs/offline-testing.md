# Synthetic offline browser tests and benchmark

## Safety boundary

These commands never use real Supabase credentials or data. The runner creates a disposable source copy under the OS temporary directory and launches a **production Next.js server** plus a **real loopback HTTP Supabase fixture**. It does not emulate backend requests with `page.route()`.

- Both build and server receive an environment **allowlist**, not the operator's inherited environment.
- `NEXT_PUBLIC_SUPABASE_URL` is explicitly `http://127.0.0.1:45431`; the publishable key is explicitly synthetic.
- Candidate source copying uses an allowlist, including root middleware/proxy, and excludes every `.env` file. Baseline extraction also excludes `.env*`.
- The fixture binds only `127.0.0.1`. Its control API is intentionally unauthenticated and **must never be exposed** through Tailscale, Serve, Funnel, or a public interface.
- Existing ports are rejected, never reused. The runner does not contact or stop the Docker daemon or existing services.
- Normal shutdown, test failure, and SIGINT/SIGTERM stop the Next and mock process groups and remove the disposable production tree. SIGKILL cannot run cleanup: inspect only PIDs printed by this runner, never kill an unrelated Next instance.
- Test reports/traces contain synthetic sessions and fake customers. They are local artifacts excluded by `e2e/.gitignore`.

## Prerequisites and commands

Use the locked dependencies and Node 22+:

```sh
npm ci
npx playwright install chromium
node --test e2e/*.test.mjs
npx playwright test
```

On a minimal Linux host, Chromium may need the packages listed by `npx playwright install-deps chromium`. Do not install system dependencies without the operator's permission.

`npx playwright test` starts its own server and builds using the standard default **Turbopack** compiler. Dependencies are copied into the disposable tree so Next's CLI and its runtime resolve the same physical installation. A symlink to an external installation is deliberately not used for this build.

To select unused ports, set both values on the invocation:

```sh
OFFLINE_APP_PORT=45440 OFFLINE_MOCK_PORT=45441 npx playwright test
```

Only one worker runs because each test resets shared HTTP fixture state. Chromium uses real service workers. No credentials, storage state, browser profile, or original-checkout build output is reused.

## What is exercised

`e2e/offline.spec.ts` verifies production login and cookie authentication; one snapshot and no detail/ticket preloading; TTL revisits; offline reload and pagination; unvisited detail and print; offline create/reload/reconnect with two tabs; external customer changes/deletions; failed download preservation; account/logout races; actual old-worker and IndexedDB-v2 migration; more than 500 records; empty snapshots; expired token refresh; concurrent-tab refresh/resource bounds; post-confirmation quota receipts; fresh-tab logout fencing; and same-owner reauthentication retaining owned pending drafts.

Printing checks the actual `window.print()` call, ticket fields/four-column DOM, warranty conditions, print-media visibility, screenshot and Chromium PDF. It never attempts to operate the system print dialog.

The legacy service worker is read from the immutable original Git revision and injected **only into the disposable synthetic build**, at `/__synthetic-legacy-worker.js`. Legacy pending records are deliberately ownerless and must remain quarantined, never assigned to the next account or sent automatically.

The HTTP fixture supports only the Auth and PostgREST surfaces exercised by this app: password sign-in, verified `getUser`, rotating refresh token, logout; list/snapshot filters and ranges; customer lookup/create/update; order create/detail/update/delete; empty attachments. It is not a replacement for Supabase/RLS/security testing against a real backend. Unknown endpoints and filters fail rather than silently succeeding.

## Artifacts

- `e2e/results/results.json`: structured Playwright result.
- `e2e/results/production-sources.json`: per-file/aggregate SHA-256 identity of the exact isolated Turbopack build, including untracked source files.
- `e2e/results/artifacts/`: one trace per test, failure screenshots, synthetic mock request attachment; print scenario also writes `offline-print.png` and `offline-ticket.pdf`.
- `npx playwright show-trace <trace.zip>` opens an individual trace.

A failed assertion is an actual failure, not an expected failure or skipped case. The fixture's request logs store method/path/query, synthetic account label, response status, payload bytes and elapsed milliseconds, never raw Authorization headers or passwords.

## Reproducible performance comparison

```sh
node scripts/offline-benchmark.mjs
```

The default protocol is 25, 52, 100 and 1,000 orders; one warmup plus **five measured repetitions** per size, per variant, on the same machine and mock. Both builds use the **same webpack compiler** and the same locked dependencies, while the separate functional suite validates the standard Turbopack build.

The baseline is immutable original `HEAD` at task start, `e033d384a96265785c9329d2d910e1bf7b691623`, extracted with `git archive` into an isolated source tree. It does not read dirty files from the original checkout. The candidate is copied from the isolated implementation worktree. Builds and startup happen outside measured intervals.

Do not run tests, builds, desktop jobs, or unrelated performance-intensive work concurrently with the benchmark. The benchmark logs `synthetic production ready` / build progress and each completed sample. Always compare a complete run, not partial logs after interruption.

The benchmark measures from login submission through **actual completion** of offline preparation and 1,000 ms of network quiet:

- Baseline coverage is counted from actual old Cache Storage detail/ticket documents after the preloader stops making requests. If the old unbounded fan-out cannot fully prepare 1,000 orders (for example Chromium resource exhaustion), its sample is explicitly incomplete, with actual cache counts and failures. It is never presented as equal completed work. CPU acceptance for 52/100 requires full baseline completion.
- Candidate completion means all expected snapshot records are committed in IndexedDB and the complete offline shell is cached.
- Every repetition uses a fresh browser context. Server/JIT warmup is excluded; cold client preparation remains part of the workload.
- Revisiting/reloading is measured separately for the zero-within-TTL-snapshot gate, not folded into initial CPU or time.

### CPU and bytes, precisely

On Linux, `/proc/<pid>/stat` user+system ticks are sampled at 100 ms for the full **Next process tree**, the **mock HTTP process**, and the full **Chromium process tree** (including renderers and service workers). Local CPU milliseconds are their sum. Child CPU fields are not added again. This is CPU **time**, not wall-clock duration or an invented percent-utilization estimate.

The harness process is excluded. A very short-lived child between samples can be undercounted, and CPU tick resolution limits tiny measurements. The report records clock ticks, CPU model/core count, kernel, Node, Playwright, compiler, revision, exact samples and measurement definitions. Trace serialization, build time and browser startup are excluded. Diagnostic trace capture is enabled only in warmups, equally in both flows. The five measured repetitions do not record traces: profiling identified DOM/network trace instrumentation inside Chromium CPU, so counting it would measure the observer too. Functional tests separately retain complete traces.

Actual network requests are captured at browser-context level, including service-worker-originated traffic. The outer page request answered by a worker is not counted again. Response body sizes come from `request.sizes()`; response headers are recorded separately. Chromium can report a negative body size (for example `-303`) for cache/SW accounting: this is not physical negative traffic. Every physical byte field is clamped to at least zero; the original `reportedSizes`, `sizeAnomalies` and `byteSource: playwright-wire-sizes-clamped-cache-anomaly` preserve the discrepancy. Missing sizes remain explicitly unavailable rather than invented. Browser-network-stack request events can include HTTP-cache hits; counts are not a socket-level server access log. Upstream mock payload bytes are a separate metric and are **not** added to browser bytes (that would double-count).

Acceptance requires zero automatic detail/ticket requests, exactly one snapshot preparation, and zero revisiting snapshot downloads within the TTL. CPU reduction must be at least **80% for 52 and 100 orders**. The runner reports all measured values and exits nonzero for a failed acceptance gate; it does not relabel a failure as success. A local synthetic benchmark is not a production capacity claim.

Output defaults to `e2e/benchmark-results/`: manifest, samples, medians/acceptance `report.json` and `report.md`, raw browser+worker/upstream request logs and trace archives for warmups. All measured samples retain raw request logs, timings, bytes and CPU; the functional suite retains its own full traces. Per-file and aggregate SHA-256 source manifests identify the exact copied build sources (including untracked implementation files), plus the harness; Git HEAD alone is not used as candidate identity.

For **diagnostics only**, not acceptance, shorter runs are available:

```sh
node scripts/offline-benchmark.mjs --counts=52 --repetitions=1 --warmups=0
node scripts/offline-benchmark.mjs --variants=baseline --output=e2e/benchmark-results/baseline-only
```

`approvedProtocol` is false unless the complete approved matrix, five repetitions and at least one warmup were executed with both variants. `--baseline-ref=<immutable-commit>` can deliberately select another baseline; the chosen revision is recorded.

## Integration verification still required

This suite supplements, not replaces, the repository's unit/regression tests, standalone importer and backup tests, strict typechecking and production build. Run those as the final integration owner. The real-data Tailscale preview is a separate deployment procedure; none of these scripts creates it or reads its configuration.

## Cache version maintenance

When changing the offline shell, its client dependency graph or the cached-data
contract, bump the shell/static cache versions in `public/order-offline-sw.js`.
Activation must remove only obsolete shell/static/private-page caches, never
IndexedDB pending queues. A completed shell manifest intentionally avoids
re-downloading assets on every visit; version changes are its upgrade boundary.
