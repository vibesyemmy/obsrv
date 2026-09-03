import { describe, expect, it } from 'vitest'
import { DEFAULT_THROTTLE, NO_THROTTLE, THROTTLE_IDS, THROTTLE_PROFILES, findThrottle, isThrottleId } from '../../src/shared/throttle'

describe('throttle profiles', () => {
  it("are Chrome DevTools' presets at their nominal figures", () => {
    expect(THROTTLE_IDS).toEqual(['none', 'fast-4g', 'slow-4g', '3g', 'cpu-4x', 'cpu-6x', 'mid-phone', 'budget-phone'])
    expect(findThrottle('3g').network).toEqual({ downloadBps: 51200, uploadBps: 51200, latencyMs: 400 })
    expect(findThrottle('slow-4g').network).toEqual({ downloadBps: 209715, uploadBps: 96000, latencyMs: 150 })
    expect(findThrottle('fast-4g').network).toEqual({ downloadBps: 524288, uploadBps: 393216, latencyMs: 20 })
    expect(findThrottle('cpu-4x')).toMatchObject({ network: null, cpuRate: 4 })
    expect(findThrottle('cpu-6x')).toMatchObject({ network: null, cpuRate: 6 })
  })
  it('the phone composites are a network preset plus a CPU rate', () => {
    expect(findThrottle('mid-phone')).toMatchObject({ network: findThrottle('slow-4g').network, cpuRate: 4 })
    expect(findThrottle('budget-phone')).toMatchObject({ network: findThrottle('3g').network, cpuRate: 6 })
  })
  it('none is the default, leaves both alone, and is the first entry', () => {
    expect(DEFAULT_THROTTLE).toBe('none')
    expect(NO_THROTTLE).toMatchObject({ id: 'none', network: null, cpuRate: 1 })
    expect(THROTTLE_PROFILES[0]).toBe(NO_THROTTLE)
  })
  it('isThrottleId and findThrottle agree, and an unknown id names the valid ones', () => {
    for (const id of THROTTLE_IDS) expect(isThrottleId(id)).toBe(true)
    for (const bad of ['edge', '', 3, null, undefined, 'CPU-4X']) expect(isThrottleId(bad)).toBe(false)
    expect(() => findThrottle('edge')).toThrow(/unknown throttle: edge \(valid: none, fast-4g/)
  })
  it('every profile has a one-line summary for menus and tool descriptions', () => {
    for (const p of THROTTLE_PROFILES) expect(p.summary.length).toBeGreaterThan(5)
  })
})
