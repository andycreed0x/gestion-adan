import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRecordBenchmarkTrace } from './benchmark-protocol.mjs'

test('keeps diagnostic traces in warmups, not in any of the five measured CPU samples', () => {
  assert.equal(shouldRecordBenchmarkTrace({ warmup: true }), true)
  for (let repetition = 1; repetition <= 5; repetition++) assert.equal(shouldRecordBenchmarkTrace({ warmup: false, repetition }), false)
})
