// CDP CPU diagnostics identified DOM/network trace capture in the browser's CPU.
// Keep one traced warmup per size/variant; measure the real app without that
// observer overhead. Functional tests independently retain full traces.
export function shouldRecordBenchmarkTrace({ warmup }) {
  return warmup === true
}
