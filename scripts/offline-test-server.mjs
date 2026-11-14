import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertPortFree, prepareProduction, repository, spawnManaged, stopAllManagedProcesses, stopProcess, syntheticEnvironment, waitForHttp } from '../e2e/support/production.mjs'

const appPort = Number(process.env.OFFLINE_APP_PORT ?? 45430)
const mockPort = Number(process.env.OFFLINE_MOCK_PORT ?? 45431)
const children = []
let production, closing = false
async function cleanup() {
  if (closing) return
  closing = true
  await stopAllManagedProcesses()
  await production?.dispose()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await cleanup(); process.exit(0) })
try {
  await assertPortFree(appPort)
  await assertPortFree(mockPort)
  const env = syntheticEnvironment({ appPort, mockPort })
  const mock = spawnManaged(process.execPath, [join(repository, 'scripts/offline-mock-supabase.mjs')], { env })
  children.push(mock)
  await waitForHttp(`http://127.0.0.1:${mockPort}/__control/health`, mock)
  production = await prepareProduction({ appPort, mockPort })
  if (closing) { await production.dispose(); process.exit(0) }
  await mkdir(join(repository, 'e2e/results'), { recursive: true })
  await writeFile(join(repository, 'e2e/results/production-sources.json'), JSON.stringify({ compiler: 'default Turbopack', synthetic: true, ...production.sources }, null, 2))
  const app = production.start()
  children.push(app)
  await waitForHttp(`http://127.0.0.1:${appPort}/login`, app)
  console.log(`Synthetic production ready: http://127.0.0.1:${appPort}, Next PID ${app.pid}, mock PID ${mock.pid}`)
  const fail = async (code) => { if (!closing) { await cleanup(); process.exit(code || 1) } }
  app.once('exit', fail)
  mock.once('exit', fail)
} catch (error) { console.error(error); await cleanup(); process.exitCode = 1 }
