import { describe, expect, it } from 'vitest'
import { orientationFromRotate, rotatedFromOrientation } from '../../src/shared/calibration'

/**
 * `bug-orientation-name`. `orientation` named the preset's STORED form, so
 * `'landscape'` produced a portrait screen on every preset stored landscape —
 * every monitor and laptop. `rotate` says the thing itself, and in the
 * breaking release it is the only way to ask (`docs/breaking-changes.md`).
 *
 * **Two describes used to stand above this one and are gone with the code they
 * covered**: `resolveRotate`, which resolved a `rotate`/`orientation` pair and
 * refused a disagreeing one, and `orientationWordNote`, which wrote the
 * sentence for a word that contradicted the screen it produced. Neither
 * function can be reached from either surface now, and they were kept alive
 * only by this file — a test holding up its own subject. What replaces their
 * coverage is `tests/unit/rotateOnlyWay.test.ts`, which checks that the word
 * really is gone from the published surface, and the two e2e refusals
 * (`mcp.spec.ts`, `cli-rotated.spec.ts`).
 *
 * The word itself stays INSIDE the app: the control server speaks it
 * (`setOrientation { orientation }`, and `status` answers with it), while every
 * MCP and CLI reply says `rotate`/`rotated`. These two translations are that
 * join, and they live in one place rather than as ternaries scattered through
 * the handlers — which is how `orientation` came to mean two things at all.
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
})
