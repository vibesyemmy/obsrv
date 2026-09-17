import { describe, expect, it } from 'vitest'
import { orientationFromRotate, orientationWordNote, resolveRotate, rotatedFromOrientation } from '../../src/shared/calibration'

/**
 * `bug-orientation-name`. `orientation` names the preset's STORED form, so
 * `'landscape'` produces a portrait screen on every preset stored landscape —
 * every monitor and laptop. `rotate` says the thing itself.
 *
 * Henry's call (option 3 of four): add `rotate`, keep `orientation`'s meaning
 * and deprecate it, refuse a disagreeing pair, and note the contradiction only
 * where the word actually lies.
 */
describe('resolveRotate', () => {
  it('rotates nothing when neither flag is given', () => {
    expect(resolveRotate(undefined, undefined)).toEqual({ rotate: false })
  })

  it('takes rotate at its word', () => {
    expect(resolveRotate(undefined, true)).toEqual({ rotate: true })
    expect(resolveRotate(undefined, false)).toEqual({ rotate: false })
  })

  it("reads orientation as the preset's stored form, which is what it has always meant", () => {
    expect(resolveRotate('landscape', undefined)).toEqual({ rotate: true })
    expect(resolveRotate('portrait', undefined)).toEqual({ rotate: false })
  })

  it('accepts a pair that agrees', () => {
    expect(resolveRotate('landscape', true)).toEqual({ rotate: true })
    expect(resolveRotate('portrait', false)).toEqual({ rotate: false })
  })

  it('refuses a pair that disagrees, rather than picking one', () => {
    // Guessing which half the caller meant is how the original defect cost a
    // day. Both directions, because a refusal that only fires one way is half
    // a check.
    for (const [o, r] of [['landscape', false], ['portrait', true]] as const) {
      const got = resolveRotate(o, r)
      expect(got, `${o}/${r} should refuse`).toHaveProperty('refuse')
      expect((got as { refuse: string }).refuse).toContain('disagree')
    }
  })
})

describe('orientationWordNote', () => {
  it('says nothing when rotate was used, because there is no word to contradict', () => {
    expect(orientationWordNote(undefined, 1080, 1920)).toBeNull()
  })

  it('says nothing when the word was true — a phone asked for landscape got landscape', () => {
    // pixel-8 is stored 412x915; rotated it is 915x412, which IS landscape.
    expect(orientationWordNote('landscape', 915, 412)).toBeNull()
    expect(orientationWordNote('portrait', 412, 915)).toBeNull()
  })

  it('speaks when the word inverted — a monitor asked for landscape got portrait', () => {
    // 1080p-24 is stored 1920x1080; 'landscape' rotates it to 1080x1920.
    const note = orientationWordNote('landscape', 1080, 1920)
    expect(note).not.toBeNull()
    expect(note).toContain('produced a portrait screen')
    expect(note).toContain('1080x1920')
    // It has to name the flag that says it directly, or the note is a
    // complaint rather than a way out.
    expect(note).toContain('rotate: true')
  })

  it('speaks for the other half too: portrait on a landscape-stored preset', () => {
    const note = orientationWordNote('portrait', 1920, 1080)
    expect(note).not.toBeNull()
    expect(note).toContain('produced a landscape screen')
    expect(note).toContain('rotate: false')
  })
})

/**
 * The same equivalence read the other way. The control server speaks in the
 * word (`setOrientation { orientation }`) and every MCP reply now also carries
 * the plain flag, so both translations live here rather than as ternaries
 * scattered through the handlers — which is how `orientation` came to mean two
 * things in the first place.
 */
describe('the word and the flag are one fact', () => {
  it('reads the rotation flag out of the word the app stores', () => {
    expect(rotatedFromOrientation('landscape')).toBe(true)
    expect(rotatedFromOrientation('portrait')).toBe(false)
  })

  it('writes the word the control server takes', () => {
    expect(orientationFromRotate(true)).toBe('landscape')
    expect(orientationFromRotate(false)).toBe('portrait')
  })

  it('round-trips both ways, so a reply cannot contradict the call that set it', () => {
    for (const word of ['portrait', 'landscape'] as const) {
      expect(orientationFromRotate(rotatedFromOrientation(word))).toBe(word)
    }
    for (const flag of [true, false]) {
      expect(rotatedFromOrientation(orientationFromRotate(flag))).toBe(flag)
    }
  })

  it('agrees with resolveRotate, the other reader of the same word', () => {
    for (const word of ['portrait', 'landscape'] as const) {
      expect(resolveRotate(word, undefined)).toEqual({ rotate: rotatedFromOrientation(word) })
    }
  })
})
