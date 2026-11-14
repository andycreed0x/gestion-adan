import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateProfile } from './profile-analysis.mjs'

test('aggregates sampled self/inclusive time by function and URL, preserving idle separately', () => {
  const profile = { startTime: 0, endTime: 6000, nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 4] },
    { id: 2, callFrame: { functionName: 'render', url: 'app.js', lineNumber: 1, columnNumber: 2 }, children: [3] },
    { id: 3, callFrame: { functionName: 'format', url: 'money.js', lineNumber: 3, columnNumber: 4 } },
    { id: 4, callFrame: { functionName: '(idle)', url: '', lineNumber: -1, columnNumber: -1 } },
  ], samples: [2, 3, 4], timeDeltas: [1000, 2000, 3000] }
  const result = aggregateProfile(profile)
  assert.equal(result.sampledMs, 6)
  assert.equal(result.idleMs, 3)
  assert.equal(result.functions.find((row) => row.functionName === 'render').selfMs, 1)
  assert.equal(result.functions.find((row) => row.functionName === 'render').inclusiveMs, 3)
  assert.equal(result.urls.find((row) => row.url === 'money.js').selfMs, 2)
})
