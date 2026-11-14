import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.OFFLINE_APP_PORT ?? 45430)
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1, // the real HTTP fixture is deliberately shared and reset per test
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'e2e/results/artifacts',
  reporter: [['list'], ['json', { outputFile: 'e2e/results/results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${appPort}`,
    serviceWorkers: 'allow',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/offline-test-server.mjs',
    url: `http://127.0.0.1:${appPort}/login`,
    reuseExistingServer: false, // never accidentally reuse the operator's real-data preview
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
