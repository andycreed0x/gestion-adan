import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { captureRequests, control, detailRequests, networkRequests, waitForPreparation } from '../e2e/support/browser.mjs'
import { shouldRecordBenchmarkTrace } from '../e2e/support/benchmark-protocol.mjs'
import { startCpuMeter } from '../e2e/support/cpu.mjs'
import { ORIGINAL_HEAD, assertPortFree, prepareProduction, repository, spawnManaged, stopAllManagedProcesses, stopProcess, syntheticEnvironment, waitForHttp } from '../e2e/support/production.mjs'

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback
const counts = arg('counts', '25,52,100,1000').split(',').map(Number)
const repetitions = Number(arg('repetitions', '5'))
const warmups = Number(arg('warmups', '1'))
const variants = arg('variants', 'baseline,candidate').split(',')
const output = resolve(arg('output', join(repository, 'e2e/benchmark-results')))
const appPort = Number(process.env.OFFLINE_APP_PORT ?? 45430)
const mockPort = Number(process.env.OFFLINE_MOCK_PORT ?? 45431)
const mockURL = `http://127.0.0.1:${mockPort}`
const baseURL = `http://127.0.0.1:${appPort}`
const baselineRef = arg('baseline-ref', ORIGINAL_HEAD)
if (counts.some((count) => !Number.isSafeInteger(count) || count < 1) || !Number.isSafeInteger(repetitions) || repetitions < 1 || !Number.isSafeInteger(warmups) || warmups < 0 || variants.some((variant) => !['baseline', 'candidate'].includes(variant))) throw new Error('Invalid benchmark arguments')
const samples = []
const sourceManifests = {}
let mock, app, browserServer, browser, production, currentContext, closing = false
async function cleanup() {
  if (closing) return
  closing = true
  await Promise.allSettled([stopProcess(app), stopProcess(mock), currentContext?.close(), browserServer?.close()])
  await browser?.close().catch(() => {})
  await stopAllManagedProcesses()
  await production?.dispose()
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await cleanup(); process.exit(130) })
await mkdir(output, { recursive: true })
const harnessFiles = await Promise.all(['e2e/support/browser.mjs', 'e2e/support/cpu.mjs', 'e2e/support/production.mjs', 'e2e/support/mock-supabase.mjs', 'scripts/offline-benchmark.mjs', 'scripts/offline-mock-supabase.mjs', 'e2e/support/benchmark-protocol.mjs'].map(async (path) => ({ path, sha256: createHash('sha256').update(await readFile(join(repository, path))).digest('hex') })))
const manifest = { synthetic: true, harness: { sha256: createHash('sha256').update(JSON.stringify(harnessFiles)).digest('hex'), files: harnessFiles }, startedAt: new Date().toISOString(), node: process.version, playwright: JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import fs from 'node:fs'; console.log(fs.readFileSync('node_modules/@playwright/test/package.json', 'utf8'))"], { cwd: repository, encoding: 'utf8' })).version, platform: platform(), kernel: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, counts, repetitions, warmups, variants, baselineRef, candidateHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), candidateDiff: execFileSync('git', ['diff', '--stat'], { cwd: repository, encoding: 'utf8' }), cpuMethod: 'Linux /proc user+system ticks at 100 ms, sum Next process tree + mock HTTP process + full Chromium process tree (renderers and service workers); no child-tick double counting. Build, browser startup, login form entry and revisit excluded. Measured repetitions do not record diagnostic traces; warmups and functional tests retain them separately. Very short-lived processes between samples may be undercounted; 10ms typical clock granularity. No percentage extrapolation.', bytesMethod: 'Browser+worker actual network request.sizes(): compressed HTTP response body bytes; synthetic upstream mock response payload bytes reported separately, not added/double-counted. Excludes cache/SW responses and failed requests.', traceMethod: 'One traced warmup per size and variant; all five measured repetitions have tracing disabled to exclude observer CPU. Raw requests, bytes, timings and process CPU are retained for every sample. Functional suite retains full traces.', completion: 'Original: every detail+ticket document actually in old page cache. Candidate: all rows committed to IndexedDB + offline shell cached. Then all browser/worker requests quiet for 1000ms. Baseline cache coverage recorded; old unbounded fan-out can fail at 1000, explicitly marked incomplete.', compiler: 'webpack for both baseline and candidate; Playwright functional acceptance uses default Turbopack', dependencies: 'Both immutable source variants use this worktree locked node_modules, same Next/React and mock, no env files copied.' }
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
try {
  await assertPortFree(appPort)
  await assertPortFree(mockPort)
  mock = spawnManaged(process.execPath, [join(repository, 'scripts/offline-mock-supabase.mjs')], { env: syntheticEnvironment({ appPort, mockPort }) })
  await waitForHttp(`${mockURL}/__control/health`, mock)
  browserServer = await chromium.launchServer({ headless: true })
  browser = await chromium.connect(browserServer.wsEndpoint())
  for (const variant of variants) {
    production = await prepareProduction({ variant, ref: baselineRef, compiler: 'webpack', appPort, mockPort })
    sourceManifests[variant] = production.sources
    await writeFile(join(output, `${variant}-sources.json`), JSON.stringify(production.sources, null, 2))
    app = production.start()
    await waitForHttp(`${baseURL}/login`, app)
    for (const count of counts) {
      for (let index = -warmups; index < repetitions; index++) {
        const warmup = index < 0
        const name = `${variant}-${count}-${warmup ? `warmup-${index + warmups + 1}` : `rep-${index + 1}`}`
        await control('reset', { count }, mockURL)
        const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' })
        currentContext = context
        const traceEnabled = shouldRecordBenchmarkTrace({ warmup })
        if (traceEnabled) await context.tracing.start({ screenshots: false, snapshots: true, sources: false })
        const page = await context.newPage()
        await page.goto('/login')
        await page.getByLabel('Email', { exact: true }).fill('a@synthetic.invalid')
        await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password')
        await control('clear-requests', {}, mockURL)
        const traffic = captureRequests(context)
        const meter = startCpuMeter({ next: app.pid, mock: mock.pid, browser: browserServer.process().pid })
        const started = performance.now()
        let cpu
        try {
          await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
          await page.waitForURL('**/orders')
          if (variant === 'baseline') {
            await expect.poll(() => networkRequests(traffic.records).filter((record) => new URL(record.url).pathname === '/api/orders').length, { timeout: 120000 }).toBe(Math.ceil(count / 25))
            await expect.poll(() => page.evaluate(async () => {
              const keys = await (await caches.open('adan-order-pages-v1')).keys()
              return keys.some((request) => /\/print$/.test(new URL(request.url).pathname))
            }), { timeout: 120000 }).toBe(true)
          } else await waitForPreparation(page, { variant, count })
          await traffic.settled(1000, 240000)
        } finally { cpu = meter.stop() }
        const elapsedMs = performance.now() - started
        const cached = variant === 'baseline' ? await page.evaluate(async () => {
          const keys = await (await caches.open('adan-order-pages-v1')).keys()
          return { details: keys.filter((request) => /^\/orders\/(?!new$)[\w-]+$/.test(new URL(request.url).pathname)).length, tickets: keys.filter((request) => /\/print$/.test(new URL(request.url).pathname)).length }
        }) : { details: count, tickets: count }
        const preparationComplete = cached.details >= count && cached.tickets >= count
        const initialRecords = structuredClone(traffic.records)
        const mockRequests = await control('requests', undefined, mockURL)
        const checkpoint = traffic.records.length
        await page.reload()
        if (variant === 'candidate') await waitForPreparation(page, { variant, count })
        await traffic.settled(1000, 240000)
        const revisit = traffic.records.slice(checkpoint)
        const network = networkRequests(initialRecords)
        const sample = { variant, count, traceEnabled, preparationComplete, cachedDetails: cached.details, cachedTickets: cached.tickets, failedRequests: initialRecords.filter((record) => record.failed).length, repetition: index + 1, warmup, ...cpu, elapsedMs, requests: network.length, bytes: network.reduce((sum, record) => sum + record.responseBodyBytes, 0), detailTicketRequests: detailRequests(initialRecords).length, snapshotRequests: network.filter((record) => new URL(record.url).pathname === '/api/orders/offline-snapshot').length, revisitSnapshotRequests: networkRequests(revisit).filter((record) => new URL(record.url).pathname === '/api/orders/offline-snapshot').length, mockRequests: mockRequests.length, mockBytes: mockRequests.reduce((sum, record) => sum + record.responseBytes, 0) }
        samples.push(sample)
        await writeFile(join(output, 'samples.json'), JSON.stringify(samples, null, 2))
        await writeFile(join(output, `${name}-requests.json`), JSON.stringify({ preparation: initialRecords, revisit, upstream: mockRequests }, null, 2))
        if (traceEnabled) await context.tracing.stop({ path: join(output, `${name}-trace.zip`) })
        traffic.stop()
        await context.close()
        currentContext = null
        console.log(`${name}: CPU ${sample.localCpuMs.toFixed(0)}ms (Next ${sample.nextCpuMs}, mock ${sample.mockCpuMs}, Chromium ${sample.browserCpuMs}), ${sample.requests} requests, ${sample.bytes} bytes, ${sample.elapsedMs.toFixed(0)}ms elapsed`)
      }
    }
    await stopProcess(app)
    app = null
    await production.dispose()
    production = null
  }
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }
  const metrics = ['cachedDetails', 'cachedTickets', 'failedRequests', 'localCpuMs', 'nextCpuMs', 'mockCpuMs', 'browserCpuMs', 'requests', 'bytes', 'elapsedMs', 'detailTicketRequests', 'snapshotRequests', 'revisitSnapshotRequests', 'mockRequests', 'mockBytes']
  const medians = []
  for (const variant of variants) for (const count of counts) {
    const group = samples.filter((sample) => sample.variant === variant && sample.count === count && !sample.warmup)
    medians.push({ variant, count, repetitions: group.length, preparationComplete: group.every((sample) => sample.preparationComplete), ...Object.fromEntries(metrics.map((metric) => [metric, median(group.map((sample) => sample[metric]))])) })
  }
  const acceptance = counts.map((count) => {
    const before = medians.find((sample) => sample.variant === 'baseline' && sample.count === count)
    const after = medians.find((sample) => sample.variant === 'candidate' && sample.count === count)
    const cpuReduction = before && after ? 1 - after.localCpuMs / before.localCpuMs : null
    const candidateSamples = samples.filter((sample) => sample.variant === 'candidate' && sample.count === count && !sample.warmup)
    return { count, cpuReduction, baselineComplete: before?.preparationComplete ?? null, candidateComplete: after?.preparationComplete ?? null, cpuTargetRequired: [52, 100].includes(count), cpuPass: cpuReduction === null ? null : ![52, 100].includes(count) || (before.preparationComplete && cpuReduction >= .8), zeroAutomaticDetailTicket: candidateSamples.length ? candidateSamples.every((sample) => sample.detailTicketRequests === 0) : null, zeroSnapshotWithinTTL: candidateSamples.length ? candidateSamples.every((sample) => sample.revisitSnapshotRequests === 0) : null, oneSnapshotPreparation: candidateSamples.length ? candidateSamples.every((sample) => sample.snapshotRequests === 1) : null }
  })
  const approvedProtocol = JSON.stringify(counts) === '[25,52,100,1000]' && repetitions === 5 && warmups >= 1 && variants.includes('baseline') && variants.includes('candidate')
  const report = { ...manifest, sourceManifests, finishedAt: new Date().toISOString(), approvedProtocol, medians, acceptance }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  const lines = ['# Synthetic offline preparation benchmark', '', `Baseline: \`${baselineRef}\`. All data synthetic; isolated production builds.`, '', `Protocol: ${warmups} warmup(s), ${repetitions} measured repetitions per size/variant. Approved full protocol: **${approvedProtocol}**.`, '', '| Flow | Orders | Local CPU ms | Next CPU ms | Browser CPU ms | Mock CPU ms | Requests | Bytes | Time ms | Detail/ticket | Revisit snapshot | Preparation complete |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|', ...medians.map((row) => `| ${row.variant} | ${row.count} | ${row.localCpuMs.toFixed(0)} | ${row.nextCpuMs.toFixed(0)} | ${row.browserCpuMs.toFixed(0)} | ${row.mockCpuMs.toFixed(0)} | ${row.requests} | ${row.bytes.toFixed(0)} | ${row.elapsedMs.toFixed(0)} | ${row.detailTicketRequests} | ${row.revisitSnapshotRequests} | ${row.preparationComplete ? 'yes' : `NO (${row.cachedDetails}/${row.count} details, ${row.cachedTickets}/${row.count} tickets)`} |`), '', '## Acceptance', '', ...acceptance.map((row) => `- ${row.count} orders: CPU reduction ${row.cpuReduction === null ? 'not compared' : `${(row.cpuReduction * 100).toFixed(1)}%`}; CPU gate ${row.cpuPass ?? 'not evaluated'}; zero details ${row.zeroAutomaticDetailTicket}; TTL ${row.zeroSnapshotWithinTTL}; one snapshot ${row.oneSnapshotPreparation}; baseline complete ${row.baselineComplete}, candidate complete ${row.candidateComplete}.`), '', '## Measurement limitations', '', manifest.cpuMethod, '', manifest.bytesMethod, '', manifest.traceMethod, '', manifest.completion, '', 'An incomplete original flow (for example Chromium resource exhaustion under unbounded 1,000-order fan-out) is reported explicitly, never described as fully prepared. Such a size is not an equal-work CPU comparison; 52/100 CPU acceptance additionally requires complete baseline work.', '', 'Warmup traces, raw requests (including worker provenance), timings, all five untraced measured repetitions and environment manifest are adjacent. Network time and CPU are different metrics. This is a local synthetic workload, not a production capacity claim.', '']
  await writeFile(join(output, 'report.md'), lines.join('\n'))
  console.log(lines.join('\n'))
  if (acceptance.some((row) => [row.candidateComplete, row.cpuPass, row.zeroAutomaticDetailTicket, row.zeroSnapshotWithinTTL, row.oneSnapshotPreparation].includes(false))) process.exitCode = 1
} catch (error) { console.error(error); process.exitCode = 1 }
finally { await cleanup() }
