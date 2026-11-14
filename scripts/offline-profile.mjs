/** Bounded diagnostic, NOT acceptance. One fresh Chromium, one 52-order preparation. */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureRequests, control, networkRequests, waitForPreparation } from '../e2e/support/browser.mjs'
import { aggregateProfile } from '../e2e/support/profile-analysis.mjs'
import { detailedCpuMeter } from '../e2e/support/profile-cpu.mjs'
import { assertPortFree, prepareProduction, repository, spawnManaged, stopAllManagedProcesses, syntheticEnvironment, waitForHttp } from '../e2e/support/production.mjs'

const output = resolve(process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ?? 'e2e/benchmark-results/profile-52')
const appPort = Number(process.env.OFFLINE_APP_PORT ?? 45430), mockPort = Number(process.env.OFFLINE_MOCK_PORT ?? 45431)
const mockURL = `http://127.0.0.1:${mockPort}`, baseURL = `http://127.0.0.1:${appPort}`
let production, browserServer, browser, context, meter, traffic, cdp
let closed = false
async function cleanup() {
  if (closed) return
  closed = true
  meter?.stop()
  traffic?.stop()
  await Promise.allSettled([stopAllManagedProcesses(), context?.close(), browserServer?.close()])
  await browser?.close().catch(() => {})
  await production?.dispose()
}
const deadline = setTimeout(async () => { console.error('Diagnostic hard deadline (180s) reached'); await cleanup(); process.exit(124) }, 180000)
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await cleanup(); process.exit(130) })
try {
  await mkdir(output, { recursive: true })
  await assertPortFree(appPort); await assertPortFree(mockPort)
  const mock = spawnManaged(process.execPath, [join(repository, 'scripts/offline-mock-supabase.mjs')], { env: syntheticEnvironment({ appPort, mockPort }) })
  await waitForHttp(`${mockURL}/__control/health`, mock)
  await control('reset', { count: 52 }, mockURL)
  production = await prepareProduction({ compiler: 'webpack', appPort, mockPort })
  await writeFile(join(output, 'sources.json'), JSON.stringify(production.sources, null, 2))
  const app = production.start()
  await waitForHttp(`${baseURL}/login`, app)
  browserServer = await chromium.launchServer({ headless: true })
  browser = await chromium.connect(browserServer.wsEndpoint())
  context = await browser.newContext({ baseURL, serviceWorkers: 'allow' })
  await context.tracing.start({ snapshots: true, screenshots: false, sources: false })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('a@synthetic.invalid')
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password')
  cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  const system = await browser.newBrowserCDPSession()
  const targetsBefore = await system.send('Target.getTargets')
  const processBefore = await system.send('SystemInfo.getProcessInfo')
  await control('clear-requests', {}, mockURL)
  traffic = captureRequests(context)
  meter = detailedCpuMeter({ next: app.pid, mock: mock.pid, browser: browserServer.process().pid })
  await cdp.send('Profiler.start')
  const started = performance.now()
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await page.waitForURL('**/orders')
  await waitForPreparation(page, { count: 52 })
  await traffic.settled(1000, 45000)
  const elapsedMs = performance.now() - started
  const { profile } = await cdp.send('Profiler.stop')
  const cpu = meter.stop(); meter = null
  const processAfter = await system.send('SystemInfo.getProcessInfo')
  const targetsAfter = await system.send('Target.getTargets')
  const aggregate = aggregateProfile(profile)
  const network = networkRequests(traffic.records)
  const result = { diagnosticOnly: true, synthetic: true, count: 52, sourceSha256: production.sources.sha256, freshBrowser: true, priorBaselineContexts: 0, intervalMicroseconds: 1000, elapsedMs, localCpuMs: cpu.processes.reduce((sum, row) => sum + row.cpuMs, 0), cpu, pageSampling: aggregate, requests: network.length, bytes: network.reduce((sum, row) => sum + row.responseBodyBytes, 0), limitation: 'Page V8 samples include idle and are wall-sampled, not process CPU. /proc is process CPU; threads subdivide process totals and must not be added again. ServiceWorker t thread names identify worker CPU even when a renderer process is shared. This is one fresh-browser cold diagnostic with profiler overhead, not a warmup/five-repeat acceptance comparison.', targetsBefore, targetsAfter, processBefore, processAfter }
  await writeFile(join(output, 'page.cpuprofile'), JSON.stringify(profile))
  await writeFile(join(output, 'profile.json'), JSON.stringify(result, null, 2))
  await writeFile(join(output, 'requests.json'), JSON.stringify({ browser: traffic.records, upstream: await control('requests', undefined, mockURL) }, null, 2))
  await context.tracing.stop({ path: join(output, 'trace.zip') })
  const lines = ['# One-scenario synthetic CPU diagnostic (not acceptance)', '', `52 orders; fresh Chromium; source SHA-256 ${result.sourceSha256}.`, `Local CPU ${result.localCpuMs}ms; elapsed ${elapsedMs.toFixed(0)}ms; ${network.length} browser-stack requests; ${result.bytes} nonnegative body bytes.`, '', '## Process CPU', '', '| PID | Kind | Name | CPU ms |', '|---:|---|---|---:|', ...cpu.processes.map((row) => `| ${row.pid} | ${row.kind} | ${row.name} | ${row.cpuMs} |`), '', '## Browser threads (subdivision, not additional CPU)', '', '| PID | TID | Thread | CPU ms |', '|---:|---:|---|---:|', ...cpu.threads.filter((row) => row.cpuMs > 0 || row.kind === 'service-worker-thread').map((row) => `| ${row.pid} | ${row.tid} | ${row.name} | ${row.cpuMs} |`), '', '## Page V8 sampled self time', '', `Sampled ${aggregate.sampledMs.toFixed(1)}ms; idle ${aggregate.idleMs.toFixed(1)}ms; GC ${aggregate.gcMs.toFixed(1)}ms. Not CPU-time attribution.`, '', '| Function | URL | Self ms | Inclusive ms |', '|---|---|---:|---:|', ...aggregate.functions.filter((row) => row.selfMs > 0).slice(0, 40).map((row) => `| ${row.functionName.replaceAll('|', '/')} | ${row.url} | ${row.selfMs.toFixed(2)} | ${row.inclusiveMs.toFixed(2)} |`), '', '## URLs by self sampling time', '', ...aggregate.urls.slice(0, 20).map((row) => `- ${row.selfMs.toFixed(2)}ms: ${row.url}`), '', result.limitation, '']
  await writeFile(join(output, 'profile.md'), lines.join('\n'))
  console.log(lines.join('\n'))
} catch (error) { console.error(error); process.exitCode = 1 }
finally { clearTimeout(deadline); await cleanup() }
