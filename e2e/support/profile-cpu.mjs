import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Diagnostic only: process totals are authoritative; thread rows subdivide, never add twice.
export function detailedCpuMeter(roots) {
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
  const previous = new Map(), rows = new Map()
  let initial = true
  const read = (path) => {
    const raw = readFileSync(path, 'utf8'), close = raw.lastIndexOf(')')
    const fields = raw.slice(close + 2).split(' ')
    return { name: raw.slice(raw.indexOf('(') + 1, close), parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]), born: fields[19] }
  }
  function sample() {
    const processes = new Map()
    for (const id of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
      try { processes.set(Number(id), read(`/proc/${id}/stat`)) } catch {}
    }
    function owner(pid) {
      const seen = new Set()
      while (pid && !seen.has(pid)) {
        seen.add(pid)
        for (const [group, root] of Object.entries(roots)) if (root === pid) return group
        pid = processes.get(pid)?.parent
      }
      return null
    }
    function add(identity, stat, data) {
      const old = previous.get(identity)
      const delta = old === undefined ? initial ? 0 : stat.ticks : Math.max(0, stat.ticks - old)
      previous.set(identity, stat.ticks)
      if (!rows.has(identity)) rows.set(identity, { ...data, name: stat.name, cpuMs: 0 })
      rows.get(identity).cpuMs += delta * 1000 / hz
    }
    for (const [pid, stat] of processes) {
      const group = owner(pid)
      if (!group) continue
      let command = ''
      try { command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ') } catch {}
      const kind = group !== 'browser' ? group : pid === roots.browser ? 'browser-main' : /--type=renderer/.test(command) ? 'renderer (may host service-worker threads)' : /--type=gpu-process/.test(command) ? 'gpu' : 'browser-utility'
      add(`p:${pid}:${stat.born}`, stat, { pid, group, kind, command, level: 'process' })
      if (group !== 'browser') continue
      try {
        for (const tid of readdirSync(`/proc/${pid}/task`)) {
          try { const thread = read(`/proc/${pid}/task/${tid}/stat`); add(`t:${tid}:${thread.born}`, thread, { pid, tid: Number(tid), group, kind: /ServiceWorker/i.test(thread.name) ? 'service-worker-thread' : 'browser-thread', level: 'thread' }) } catch {}
        }
      } catch {}
    }
    initial = false
  }
  sample()
  const interval = setInterval(sample, 100)
  return { stop() { clearInterval(interval); sample(); return { clockTicksPerSecond: hz, processes: [...rows.values()].filter((row) => row.level === 'process').sort((a, b) => b.cpuMs - a.cpuMs), threads: [...rows.values()].filter((row) => row.level === 'thread').sort((a, b) => b.cpuMs - a.cpuMs) } } }
}
