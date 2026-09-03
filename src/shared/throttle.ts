/**
 * Network and CPU throttling for a render: how the page *feels* on the
 * screens Obsrv simulates. Cheap screens come with cheap CPUs and bad
 * networks, and a page that paints in a second on a laptop over fibre can
 * take seven on a budget phone over 3G — the number an agent needs beside
 * the picture.
 *
 * The presets are Chrome DevTools' own, at their nominal figures, so a
 * developer who has used "Slow 4G" or "CPU: 6× slowdown" there gets the
 * same thing here. Applied through Chromium's debugger on the target
 * (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`),
 * which is exactly what DevTools does.
 */

export interface NetworkConditions {
  /** Bytes per second. */
  downloadBps: number
  uploadBps: number
  /** Round-trip latency added to every request. */
  latencyMs: number
}

export interface ThrottleProfile {
  id: string
  label: string
  /** Null: the network is left alone. */
  network: NetworkConditions | null
  /** 1: the CPU is left alone; 4 and 6 are DevTools' mid-tier and low-end phone. */
  cpuRate: number
  /** One line for a menu or a tool description. */
  summary: string
}

const mbps = (n: number): number => Math.round((n * 1024 * 1024) / 8)
const kbps = (n: number): number => Math.round((n * 1024) / 8)

const FAST_4G: NetworkConditions = { downloadBps: mbps(4), uploadBps: mbps(3), latencyMs: 20 }
const SLOW_4G: NetworkConditions = { downloadBps: mbps(1.6), uploadBps: kbps(750), latencyMs: 150 }
const THREE_G: NetworkConditions = { downloadBps: kbps(400), uploadBps: kbps(400), latencyMs: 400 }

export const THROTTLE_PROFILES: readonly ThrottleProfile[] = [
  { id: 'none', label: 'No throttle', network: null, cpuRate: 1, summary: 'the host as it is' },
  { id: 'fast-4g', label: 'Fast 4G', network: FAST_4G, cpuRate: 1, summary: '4 Mbps down, 3 Mbps up, 20 ms' },
  { id: 'slow-4g', label: 'Slow 4G', network: SLOW_4G, cpuRate: 1, summary: '1.6 Mbps down, 750 Kbps up, 150 ms' },
  { id: '3g', label: '3G', network: THREE_G, cpuRate: 1, summary: '400 Kbps each way, 400 ms' },
  { id: 'cpu-4x', label: 'CPU 4× slower', network: null, cpuRate: 4, summary: 'a mid-tier phone’s CPU' },
  { id: 'cpu-6x', label: 'CPU 6× slower', network: null, cpuRate: 6, summary: 'a low-end phone’s CPU' },
  { id: 'mid-phone', label: 'Mid-tier phone', network: SLOW_4G, cpuRate: 4, summary: 'Slow 4G and CPU 4×' },
  { id: 'budget-phone', label: 'Budget phone', network: THREE_G, cpuRate: 6, summary: '3G and CPU 6×' },
]

export type ThrottleId = (typeof THROTTLE_PROFILES)[number]['id']

export const THROTTLE_IDS = THROTTLE_PROFILES.map(p => p.id) as [string, ...string[]]

export const DEFAULT_THROTTLE = 'none'

export const NO_THROTTLE: ThrottleProfile = THROTTLE_PROFILES[0]!

export function isThrottleId(v: unknown): v is string {
  return typeof v === 'string' && THROTTLE_PROFILES.some(p => p.id === v)
}

/** Throws on an unknown id, naming the valid ones — the CLI and the tools both validate first. */
export function findThrottle(id: string): ThrottleProfile {
  const p = THROTTLE_PROFILES.find(t => t.id === id)
  if (!p) throw new Error(`unknown throttle: ${id} (valid: ${THROTTLE_IDS.join(', ')})`)
  return p
}
