import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** Linux CPU time, not utilization: sum process user+system ticks, never child ticks twice. */
export function startCpuMeter(roots) {
  if (process.platform !== 'linux') throw new Error('Comparable whole-browser + Next CPU measurement requires Linux /proc')
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
  const previous = new Map(), totals = Object.fromEntries(Object.keys(roots).map((key) => [key, 0]))
  let initialized = false
  function sample() {
    const processes = new Map()
    for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        processes.set(Number(pid), { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]), born: fields[19] })
      } catch { /* a process exited during sampling */ }
    }
    const owner = (pid) => {
      const visited = new Set()
      while (pid && !visited.has(pid)) {
        visited.add(pid)
        const group = Object.keys(roots).find((key) => roots[key] === pid)
        if (group) return group
        pid = processes.get(pid)?.parent
      }
      return null
    }
    for (const [pid, stat] of processes) {
      const group = owner(pid)
      if (!group) continue
      const identity = `${pid}:${stat.born}`
      const old = previous.get(identity)
      if (old !== undefined) totals[group] += Math.max(0, stat.ticks - old)
      else if (initialized) totals[group] += stat.ticks
      previous.set(identity, stat.ticks)
    }
    initialized = true
  }
  sample()
  const interval = setInterval(sample, 100)
  return {
    stop() {
      clearInterval(interval)
      sample()
      const groups = Object.fromEntries(Object.entries(totals).map(([key, ticks]) => [`${key}CpuMs`, ticks * 1000 / hz]))
      return { ...groups, localCpuMs: Object.values(groups).reduce((sum, value) => sum + value, 0), clockTicksPerSecond: hz }
    },
  }
}
