export function aggregateProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map(), functions = new Map(), urls = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
  const key = (frame) => `${frame.functionName}|${frame.url}|${frame.lineNumber}|${frame.columnNumber}`
  let sampledMs = 0, idleMs = 0, gcMs = 0
  for (let index = 0; index < (profile.samples ?? []).length; index++) {
    const ms = (profile.timeDeltas?.[index] ?? 0) / 1000
    const node = nodes.get(profile.samples[index])
    if (!node) continue
    const frame = node.callFrame
    sampledMs += ms
    if (frame.functionName === '(idle)') idleMs += ms
    if (frame.functionName === '(garbage collector)') gcMs += ms
    const seen = new Set()
    let id = node.id
    while (id !== undefined) {
      const ancestor = nodes.get(id)
      if (!ancestor) break
      const k = key(ancestor.callFrame)
      if (!functions.has(k)) functions.set(k, { ...ancestor.callFrame, selfMs: 0, inclusiveMs: 0, samples: 0 })
      if (!seen.has(k)) { functions.get(k).inclusiveMs += ms; seen.add(k) }
      id = parents.get(id)
    }
    const entry = functions.get(key(frame))
    entry.selfMs += ms
    entry.samples++
    const url = frame.url || `(native: ${frame.functionName})`
    if (!urls.has(url)) urls.set(url, { url, selfMs: 0, samples: 0 })
    urls.get(url).selfMs += ms
    urls.get(url).samples++
  }
  return { sampledMs, idleMs, gcMs, wallMs: (profile.endTime - profile.startTime) / 1000, functions: [...functions.values()].sort((a, b) => b.selfMs - a.selfMs), urls: [...urls.values()].sort((a, b) => b.selfMs - a.selfMs) }
}
