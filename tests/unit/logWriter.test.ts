import { describe, expect, it } from 'vitest'
import { formatLine, writerTag } from '../../src/shared/logFile'

/**
 * Who wrote a log line.
 *
 * `scripts/devLane.js:126` passes `--user-data-dir`, which moves `userData`
 * and **not** `logs`, so a dev-lane app and the installed app both write
 * `~/Library/Logs/Obsrv/obsrv.log`. Nothing in a line says which. Whether they
 * have ever interleaved is unknowable from the artefact — the format has no
 * field naming a writer, so "no lines mention the lane" fits *never wrote* and
 * *wrote anonymously* equally, and that unreadability is the defect.
 *
 * The precedent is the dev lane's own MCP reply, which names the tree it
 * serves. That sentence caught a false green twice in one day. The log has no
 * equivalent; this gives it one.
 *
 * **What the identity has to be, and the trap:** a tag naming the BUILD is not
 * a tag naming the INSTANCE. Two lanes off the same commit, or two runs of the
 * same lane, would collapse together again. The thing that actually
 * distinguishes one Obsrv from another is its PROFILE — `userData`, which
 * `--user-data-dir` is exactly what moves — and the thing that distinguishes
 * two runs of one profile is the pid.
 */
describe('writerTag: which Obsrv wrote this', () => {
  const installed = '/Users/x/Library/Application Support/Obsrv'

  it('names the installed app by kind, not by path', () => {
    expect(writerTag({ userData: installed, pid: 4242, packaged: true, env: {} })).toBe('app#4242')
  })

  it('names a dev lane, and by its label when it has one', () => {
    const t = writerTag({
      userData: '/Users/x/.obsrv-dev/profile',
      pid: 4242,
      packaged: false,
      env: { OBSRV_DEV_LANE: '/repo', OBSRV_DEV_LANE_LABEL: 'rook' },
    })
    expect(t).toBe('lane:rook#4242')
  })

  it('distinguishes two lanes that share a commit, which a build tag would not', () => {
    // The trap: these are the same code. Only the profile and the pid differ,
    // and a line that named the build would call them the same writer.
    const a = writerTag({ userData: '/Users/x/.obsrv-dev/profile', pid: 1, packaged: false, env: { OBSRV_DEV_LANE: '/repo' } })
    const b = writerTag({ userData: '/tmp/kenya-lane/profile', pid: 2, packaged: false, env: { OBSRV_DEV_LANE: '/repo' } })
    expect(a).not.toBe(b)
  })

  it('distinguishes two runs of ONE profile, which a profile tag alone would not', () => {
    const first = writerTag({ userData: installed, pid: 1, packaged: true, env: {} })
    const second = writerTag({ userData: installed, pid: 2, packaged: true, env: {} })
    expect(first).not.toBe(second)
  })

  it('names the e2e harness, which shares the machine with both', () => {
    expect(writerTag({ userData: '/tmp/obsrv-e2e-a/x', pid: 7, packaged: false, env: { OBSRV_TEST: '1' } })).toBe('test#7')
  })

  it('falls back to a profile discriminator when nothing names the instance', () => {
    // An unpackaged app with no lane and no test flag — someone running
    // `npm run dev`, or a third instance neither flag knows about, which is
    // the case moving the lane's logs would not have covered.
    const t = writerTag({ userData: '/Users/x/Documents/Projects/Obsrv/profile', pid: 9, packaged: false, env: {} })
    expect(t).toMatch(/^dev:[0-9a-f]{4}#9$/)
  })

  it('is stable for one profile across calls, so a reader can group by it', () => {
    const args = { userData: '/some/other/profile', pid: 9, packaged: false, env: {} }
    expect(writerTag(args)).toBe(writerTag(args))
  })
})

describe('formatLine: the stamp on the line', () => {
  it('carries the writer between the level and the message', () => {
    const line = formatLine('info', 'gpu: compositing enabled', new Date('2026-09-15T07:10:00.000Z'), 'lane:rook#4242')
    expect(line).toBe('2026-09-15T07:10:00.000Z info  lane:rook#4242 gpu: compositing enabled\n')
  })

  it('still formats without one, so every existing caller keeps working', () => {
    const line = formatLine('warn', 'something', new Date('2026-09-15T07:10:00.000Z'))
    expect(line).toBe('2026-09-15T07:10:00.000Z warn  something\n')
  })

  it('folds newlines whether or not a writer is present', () => {
    const line = formatLine('error', 'two\nlines', new Date('2026-09-15T07:10:00.000Z'), 'app#1')
    expect(line).not.toMatch(/\n.*\n$/)
    expect(line).toContain('app#1')
  })
})
