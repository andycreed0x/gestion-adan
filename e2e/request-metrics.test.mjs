import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeRequestSizes } from './support/browser.mjs'

test('retains nonnegative wire sizes without changing their totals', () => {
  const sizes = { requestBodySize: 12, requestHeadersSize: 90, responseBodySize: 4096, responseHeadersSize: 303 }
  assert.deepEqual(normalizeRequestSizes(sizes), {
    requestBodyBytes: 12, responseBodyBytes: 4096, responseHeadersBytes: 303,
    byteSource: 'playwright-wire-sizes', reportedSizes: sizes, sizeAnomalies: [],
  })
})

test('clamps Chromium negative cache accounting to zero physical bytes and preserves an anomaly marker', () => {
  const sizes = { requestBodySize: 0, requestHeadersSize: 90, responseBodySize: -303, responseHeadersSize: 303 }
  const record = normalizeRequestSizes(sizes)
  assert.equal(record.responseBodyBytes, 0)
  assert.equal(record.responseHeadersBytes, 303)
  assert.equal(record.reportedSizes.responseBodySize, -303)
  assert.equal(record.byteSource, 'playwright-wire-sizes-clamped-cache-anomaly')
  assert.deepEqual(record.sizeAnomalies, [{ field: 'responseBodySize', reported: -303, classification: 'negative-size-cache-accounting' }])
  assert.equal([record, normalizeRequestSizes({ ...sizes, responseBodySize: 50 })].reduce((sum, item) => sum + item.responseBodyBytes, 0), 50)
})

test('never invents transferred bytes when sizes are unavailable and clamps every physical byte field', () => {
  const missing = normalizeRequestSizes(null)
  assert.equal(missing.byteSource, 'unavailable')
  assert.equal(missing.responseBodyBytes, 0)
  assert.equal(missing.reportedSizes, null)
  const negative = normalizeRequestSizes({ requestBodySize: -1, responseBodySize: -2, responseHeadersSize: -3 })
  assert.equal(negative.requestBodyBytes, 0)
  assert.equal(negative.responseBodyBytes, 0)
  assert.equal(negative.responseHeadersBytes, 0)
  assert.equal(negative.sizeAnomalies.length, 3)
})
