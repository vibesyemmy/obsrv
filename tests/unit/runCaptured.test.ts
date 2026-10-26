import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * The defect this guards: `execFileSync`'s return value is stdout only.
 * `codesign -dv --verbose=4` writes its entire report to stderr, so the
 * previous implementation of this helper read back `''` for a correctly
 * signed `.app` — identical to what a truly unsigned one produces — and
 * `verifySigningIdentity.js` failed every signed build with "no Authority
 * line at all". Proven here with a child process that writes to both
 * streams, not with codesign itself, so the test does not depend on a
 * signing identity existing on the machine that runs it.
 */
const { runCaptured } = createRequire(__filename)('../../scripts/lib/run.js') as {
  runCaptured: (cmd: string, args: string[]) => string
}

describe('runCaptured', () => {
  it('includes stderr output, not only stdout', () => {
    const out = runCaptured('node', ['-e', "console.error('from stderr')"])
    expect(out).toContain('from stderr')
  })

  it('includes stdout output too', () => {
    const out = runCaptured('node', ['-e', "console.log('from stdout')"])
    expect(out).toContain('from stdout')
  })

  it('combines both when a command writes to each', () => {
    const out = runCaptured('node', ['-e', "console.log('out-line'); console.error('err-line')"])
    expect(out).toContain('out-line')
    expect(out).toContain('err-line')
  })

  it('throws on a non-zero exit, with the output in the message', () => {
    expect(() => runCaptured('node', ['-e', "console.error('boom'); process.exit(1)"])).toThrow(/boom/)
  })

  it('throws when the command does not exist', () => {
    expect(() => runCaptured('this-command-does-not-exist-anywhere', [])).toThrow()
  })
})
