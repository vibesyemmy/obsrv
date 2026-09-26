import { describe, expect, it } from 'vitest'
import { CONTROL_COMMANDS } from '../../src/shared/control'
import { validateFlow } from '../../src/shared/flow'

describe('validateFlow', () => {
  it('accepts a well-formed step list', () => {
    const result = validateFlow([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'setPreset', id: 'laptop-768' },
      { action: 'click', target: '.checkout-button' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'setPreset', id: 'laptop-768' },
      { action: 'click', target: '.checkout-button' },
    ])
  })

  it('accepts an empty step list', () => {
    const result = validateFlow([])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([])
  })

  it('rejects a top-level value that is not an array, at index -1', () => {
    for (const bad of [{}, 'steps', 3, null, undefined, true]) {
      const result = validateFlow(bad)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected rejection')
      expect(result.rejections).toEqual([{ index: -1, reason: expect.stringContaining('array') }])
    }
  })

  it('rejects a step that is not an object, naming what it actually got', () => {
    const result = validateFlow(['not an object', 3, null, ['nested', 'array']])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([
      { index: 0, reason: expect.stringContaining('object') },
      { index: 1, reason: expect.stringContaining('object') },
      { index: 2, reason: expect.stringContaining('object') },
      { index: 3, reason: expect.stringContaining('object') },
    ])
  })

  it('rejects a step missing "action"', () => {
    const result = validateFlow([{ target: '.foo' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/missing.*action/i) }])
  })

  it('rejects a step whose "action" is not a string', () => {
    const result = validateFlow([{ action: 7 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/action.*string/i) }])
  })

  it('rejects an "action" outside the known control-command vocabulary, naming the valid ones', () => {
    const result = validateFlow([{ action: 'teleport' }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0]!.reason).toMatch(/teleport/)
    for (const c of CONTROL_COMMANDS) expect(result.rejections[0]!.reason).toContain(c)
  })

  it('rejects a step whose "target" is present but not a string', () => {
    const result = validateFlow([{ action: 'click', target: 42 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections).toEqual([{ index: 0, reason: expect.stringMatching(/target.*string/i) }])
  })

  it('accepts a step with no "target" at all — it is optional', () => {
    const result = validateFlow([{ action: 'reload' }])
    expect(result.ok).toBe(true)
  })

  it('collects a rejection per bad step rather than stopping at the first', () => {
    const result = validateFlow([
      { action: 'navigate', url: 'https://example.com' },
      { action: 'teleport' },
      { target: '.foo' },
      { action: 'click', target: 5 },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.rejections.map(r => r.index)).toEqual([1, 2, 3])
  })

  it('validates a step whose passthrough data includes a "reason" field — the discriminator must not key off it', () => {
    const result = validateFlow([{ action: 'navigate', target: 'https://x.test', reason: 'verify the cart persists' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([{ action: 'navigate', target: 'https://x.test', reason: 'verify the cart persists' }])
  })

  it('validates a step whose passthrough data includes an "index" field', () => {
    const result = validateFlow([{ action: 'navigate', index: 7 }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps).toEqual([{ action: 'navigate', index: 7 }])
  })

  it('carries arbitrary extra fields on a step through unvalidated', () => {
    const result = validateFlow([{ action: 'navigate', url: 'https://example.com', timeoutMs: 5000, note: 'first step' }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.flow.steps[0]).toEqual({ action: 'navigate', url: 'https://example.com', timeoutMs: 5000, note: 'first step' })
  })
})
