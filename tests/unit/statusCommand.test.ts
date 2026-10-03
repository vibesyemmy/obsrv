import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `npm run status`: what is true right now, with the source and the time it was read.
 *
 * It exists because the team kept reporting facts that had moved (a PR head, a merge rule, a PASS
 * "not in my record"). So every claim here is about a way a status line goes wrong:
 *   - the PASS ledger takes a recap's list of six heads for the one PR that was passed;
 *   - a prefix compare lets a SHA that differs in its last character read as a match;
 *   - a run is matched to a PR by branch or by prefix and quotes a result for a commit that was replaced;
 *   - a section that could not be read looks like a section with nothing in it.
 *
 * The PASS parser is tested against REAL messages from the room (tests/fixtures/status), not invented ones:
 * the hard part was never finding the word "PASS", it was which PR, which SHA, and whether it was a verdict.
 */
const status = createRequire(__filename)('../../scripts/status.js') as {
  defaultRun: (cmd: string, args: string[]) => string
  readRoomMessages: (run: (cmd: string, args: string[]) => string, env: Record<string, string | undefined>) => unknown[]
  firstSha: (text: string) => { sha: string; truncated: boolean } | null
  verdictsInMessage: (body: string) => Array<{ pr: number; sha: string | null; truncated: boolean; line: string }>
  compareSha: (named: string | null, head: string) => string
  passLedger: (messages: Msg[], heads: Map<number, string>) => { byPr: Map<number, Row[]>; notOpen: number }
  mainSection: (sha: string, source: string, at: Date) => { text: string; ok: boolean }
  prSection: (prs: Pr[], source: string, at: Date) => { text: string; ok: boolean }
  ciSection: (prs: Pr[], runs: Run[], source: string, at: Date, windowSize: number) => { text: string; ok: boolean }
  inFlightSection: (prs: Pr[], runs: Run[], source: string, at: Date) => { text: string; ok: boolean }
  ledgerSection: (prs: Pr[], ledger: { byPr: Map<number, Row[]>; notOpen: number }, source: string, at: Date) => { text: string; ok: boolean }
  buildReport: (run: (cmd: string, args: string[]) => string, env: Record<string, string | undefined>, now: () => Date) => { text: string; ok: boolean }
}

interface Msg { seq: number; author: string; at: number; body: string }
interface Row { seq: number; author: string; at: number; sha: string | null; truncated: boolean; status: string; line: string }
interface Pr { number: number; headRefOid: string; mergeStateStatus: string; mergeable: string; headRefName: string; isDraft?: boolean }
interface Run { databaseId: number; attempt: number; headSha: string; headBranch: string; status: string; conclusion: string; event: string; createdAt: string; updatedAt: string }

const messages = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'status', 'pass-messages.json'), 'utf8')) as Msg[]
const msg = (seq: number): Msg => {
  const m = messages.find(x => x.seq === seq)
  if (!m) throw new Error(`fixture message ${seq} is missing`)
  return m
}
const verdicts = (seq: number) => status.verdictsInMessage(msg(seq).body)

const AT = new Date('2026-10-03T14:10:00Z')
const H544 = 'da3e6283d314f4f2720462d4d0b0cade557c7ec8'
const H544_OLD = '96964667b5414d1b6e3548de146cb2e196804c84'
const H543 = 'd58d132de1b7ee63105445c6214c393ad190ed59'
const H538 = '59d5034e454a9cdf2c2546a55cd35d27beef9b07'
const H539 = 'db5329e2d2984e64240f80aad5efe204c8c4db23'

describe('the PASS parser, on the real messages', () => {
  it.each([
    [2900, 535, 'e28972e0c7fbd82908eb3054e012d6c8048ae492', 'PASS — #535 at <sha>: the em dash form'],
    [2934, 537, 'bc28120dd33e5f8552be676de3898b02ccf0ea3a', 'the em dash form again'],
    [2963, 540, 'afa0c93cd9205bcbcb9039d8d865c0a0eeb3c1cb', 'PASS: #540 at <sha>: the colon form'],
    [2976, 541, 'a9ff0fc3ff84b3d55b51a3f2943d8f87fa0af6c0', 'the colon form'],
    [3140, 545, '8ba7b77863838568f8faaf41ebd196840ae7de22', 'the colon form'],
    [3130, 542, 'a30c2faf9893ab82addb3b1d9c042b9ee2ff18b6', 'the PR first, then PASS, mid-message after other text'],
  ])('message #%i is a PASS for #%i naming %s (%s)', (seq, pr, sha) => {
    expect(verdicts(seq)).toMatchObject([{ pr, sha, truncated: false }])
  })

  it('reads a verdict through the markdown that wraps it', () => {
    // Bold and code spans around the PR and the verb: a literal `^PASS` or `^#\d+` misses all three shapes.
    expect(status.verdictsInMessage('**PASS — `#535` at `e28972e0c7fbd82908eb3054e012d6c8048ae492`**')).toMatchObject([{ pr: 535 }])
    expect(status.verdictsInMessage('**`#542`: PASS at `a30c2faf9893ab82addb3b1d9c042b9ee2ff18b6`**')).toMatchObject([{ pr: 542 }])
    expect(status.verdictsInMessage('**`#539` — PASS.**')).toMatchObject([{ pr: 539, sha: null }])
  })

  it('puts a PASS that names no SHA in its own bucket, rather than dropping it or guessing one', () => {
    expect(verdicts(2941)).toMatchObject([{ pr: 539, sha: null }])
    // #2933 is a bold PASS in the middle of a sentence that names its PR earlier on the same line.
    expect(verdicts(2933)).toMatchObject([{ pr: 538, sha: null }])
  })

  it('takes the SHA of the verdict, not the six heads that a "counted heads" recap lists after it', () => {
    // #3100, #3134 and #3144 each end with every open PR's head while the PASS is for one. "Any SHA in the
    // message" reads that tail as the head of the PR passed; "the first SHA after the verb" does not.
    expect(verdicts(3100)).toMatchObject([{ pr: 543, sha: H543 }])
    expect(verdicts(3134)).toMatchObject([{ pr: 544, sha: H544_OLD }])
    expect(verdicts(3144)).toMatchObject([{ pr: 544, sha: H544 }])
  })

  it('returns one row per verdict line: #3161 passes two PRs in one message, each with its own SHA', () => {
    const rows = verdicts(3161)
    expect(rows.map(r => [r.pr, r.sha])).toEqual([
      [538, H538],
      [539, H539],
    ])
  })

  it.each([
    [2961, '"this is not a PASS yet"'],
    [3094, '"Not a PASS yet"'],
    [3095, '"Verdict stays: not PASS"'],
    [3120, '"interim, not a verdict" (and a PASS mentioned by number)'],
    [3139, '"The PASS at 96964667… is superseded"'],
    [2975, '"my numbers, which are not the gate"'],
  ])('message #%i contains PASS and is not one: no row (%s)', seq => {
    expect(verdicts(seq)).toEqual([])
  })

  it.each([3157, 3159])('message #%i recaps other people\'s PASSes, names many PRs and SHAs, and is not a verdict', seq => {
    expect(verdicts(seq)).toEqual([])
  })

  it('does not read an acknowledgement as a verdict', () => {
    // "#544 PASS at <sha> noted, thank you": someone ELSE's PASS being acknowledged. The separator between
    // the PR and the verb is what a verdict has and an acknowledgement does not.
    expect(status.verdictsInMessage('`#544` PASS at `da3e6283…` noted, and thank you both.')).toEqual([])
  })
})

describe('what counts as a SHA', () => {
  it('refuses English words that happen to be made of a-f (defaced, acceded, effaced)', () => {
    for (const word of ['defaced', 'acceded', 'effaced', 'decade', 'deadbeef']) expect(status.firstSha(`PASS ${word} here`)).toBeNull()
    // …and so a verdict line whose only hex-looking token is a word names no SHA.
    expect(status.verdictsInMessage('**PASS: `#12` at defaced**')).toMatchObject([{ pr: 12, sha: null }])
  })

  it('refuses a CI run id, which is all hex digits and is not a commit', () => {
    expect(status.firstSha('run 37123672372 passed')).toBeNull()
    expect(status.firstSha(`run 37123672372 at ${H544}`)).toMatchObject({ sha: H544 })
  })

  it('accepts a real all-digit seven-character abbreviation (6849985 is a commit in this repo)', () => {
    expect(status.firstSha('PASS on 6849985.')).toMatchObject({ sha: '6849985' })
  })

  it('is not fooled by a message or PR reference, an uppercase token, or a word longer than 40 characters', () => {
    expect(status.firstSha('see #3144 and #1234567')).toBeNull()
    expect(status.firstSha('DA3E6283D314F4F2720462D4D0B0CADE557C7EC8')).toBeNull()
    expect(status.firstSha(`${H544}0`)).toBeNull()
  })

  it('marks a token followed by an ellipsis as a truncated display', () => {
    expect(status.firstSha('PASS at da3e6283…')).toEqual({ sha: 'da3e6283', truncated: true })
    expect(status.firstSha(`PASS at ${H544}`)).toEqual({ sha: H544, truncated: false })
  })
})

describe('comparing the SHA a PASS names to the head', () => {
  it('compares a full SHA IN FULL: one wrong character is STALE, where a prefix compare would say MATCH', () => {
    expect(status.compareSha(H544, H544)).toBe('MATCH')
    const lastCharChanged = H544.slice(0, 39) + (H544.endsWith('8') ? '9' : '8')
    expect(lastCharChanged).not.toBe(H544)
    expect(status.compareSha(lastCharChanged, H544)).toBe('STALE')
    // …and one changed in the middle, past the 8 characters a person would eyeball.
    expect(status.compareSha(H544.slice(0, 20) + 'f' + H544.slice(21), H544)).toBe(H544[20] === 'f' ? 'MATCH' : 'STALE')
  })

  it('treats a short SHA as a prefix, and says how short it was', () => {
    expect(status.compareSha('da3e6283', H544)).toBe('MATCH (prefix of 8)')
    expect(status.compareSha('da3e6284', H544)).toBe('STALE')
  })

  it('reports a verdict with no SHA as NO SHA, never as a match', () => {
    expect(status.compareSha(null, H544)).toBe('NO SHA')
  })
})

describe('the ledger', () => {
  const heads = new Map<number, string>([
    [544, H544],
    [543, H543],
    [538, H538],
    [539, H539],
    [545, '8ba7b77863838568f8faaf41ebd196840ae7de22'],
  ])
  const ledger = status.passLedger(messages, heads)

  it('lists EVERY PASS for a PR, newest first, so a STALE row sits above the MATCH instead of being hidden by it', () => {
    // #3144 (the current head) is newer than #3134 (the head it replaced). Newest first puts the MATCH on top and
    // the STALE under it, and BOTH are listed: the latest one never hides the history.
    expect(ledger.byPr.get(544)!.map(r => [r.seq, r.status])).toEqual([
      [3144, 'MATCH'],
      [3134, 'STALE'],
    ])
  })

  it('gives #538 and #539 their 09-30 PASSes (no SHA) and the re-PASS at their full SHAs, newest first', () => {
    expect(ledger.byPr.get(538)!.map(r => [r.seq, r.status])).toEqual([
      [3161, 'MATCH'],
      [2933, 'NO SHA'],
    ])
    expect(ledger.byPr.get(539)!.map(r => [r.seq, r.status])).toEqual([
      [3161, 'MATCH'],
      [2941, 'NO SHA'],
    ])
  })

  it('counts a PASS for a PR that is not open instead of listing it', () => {
    // #2900 passes #535, #2934 passes #537: neither is open in this fixture.
    expect(ledger.notOpen).toBeGreaterThanOrEqual(2)
    expect(ledger.byPr.has(535)).toBe(false)
  })

  it('does not let a head that moved go on reading MATCH: the same message is STALE against the new head', () => {
    const moved = status.passLedger(messages, new Map([[544, 'a'.repeat(7) + '1'.repeat(33)]]))
    expect(moved.byPr.get(544)!.map(r => r.status)).toEqual(['STALE', 'STALE'])
  })
})

const pr = (number: number, head: string, state = 'CLEAN', branch = `b/${number}`): Pr => ({ number, headRefOid: head, mergeStateStatus: state, mergeable: 'MERGEABLE', headRefName: branch })
const run = (id: number, head: string, over: Partial<Run> = {}): Run => ({
  databaseId: id,
  attempt: 1,
  headSha: head,
  headBranch: 'b',
  status: 'completed',
  conclusion: 'success',
  event: 'pull_request',
  createdAt: '2026-10-03T12:00:00Z',
  updatedAt: '2026-10-03T12:25:00Z',
  ...over,
})

describe('the sections', () => {
  it('prints main\'s FULL head, with its source and the time it was read', () => {
    const { text } = status.mainSection('f6007be6b6bb6766da6d78770539059c271ef004', 'gh api …', AT)
    expect(text).toContain('== main  (gh api …, as of 14:10Z)')
    expect(text).toContain('f6007be6b6bb6766da6d78770539059c271ef004')
  })

  it('lists open PRs by number with the full head and the merge state of each', () => {
    const { text } = status.prSection([pr(544, H544, 'CLEAN'), pr(538, H538, 'BEHIND')], 'gh pr list', AT)
    const rows = text.split('\n').filter(l => l.startsWith('#'))
    expect(rows).toEqual([`#538  ${H538}  BEHIND/MERGEABLE  b/538`, `#544  ${H544}  CLEAN/MERGEABLE  b/544`])
  })

  it('says "(none open)" for an empty list, which is a read, not a failure', () => {
    expect(status.prSection([], 'gh pr list', AT).text).toContain('(none open)')
  })

  describe('CI per head', () => {
    it('matches a run to a head by the run\'s OWN headSha, in full, and prints the attempt', () => {
      const runs = [run(37123672372, H544, { attempt: 2 }), run(37121114498, H544_OLD)]
      const { text } = status.ciSection([pr(544, H544)], runs, 'gh run list', AT, 100)
      expect(text).toContain('#544  run 37123672372 attempt 2  pull_request  completed/success')
      // The run for the head this PR REPLACED is not quoted for it.
      expect(text).not.toContain('37121114498')
    })

    it('does not match a run whose headSha only shares a prefix with the head', () => {
      const lookalike = H544.slice(0, 12) + '0'.repeat(28)
      const { text } = status.ciSection([pr(544, H544)], [run(111, lookalike)], 'gh run list', AT, 100)
      expect(text).toContain('#544  no run for this head in the last 100 runs')
      expect(text).not.toContain('run 111')
    })

    it('says "no run for this head" rather than falling back to the branch\'s latest run', () => {
      const { text } = status.ciSection([pr(544, H544, 'CLEAN', 'fix/x')], [run(222, H543, { headBranch: 'fix/x' })], 'gh run list', AT, 100)
      expect(text).toContain('no run for this head')
    })

    it('prints the LATEST run for the head and counts the earlier ones', () => {
      const runs = [run(1, H544, { createdAt: '2026-10-03T10:00:00Z', conclusion: 'cancelled' }), run(2, H544, { createdAt: '2026-10-03T11:00:00Z' })]
      const { text } = status.ciSection([pr(544, H544)], runs, 'gh run list', AT, 100)
      expect(text).toContain('run 2 attempt 1')
      expect(text).toContain('(+1 earlier run for this head)')
    })

    it('shows a run that is not finished as its status, not as a conclusion it does not have', () => {
      const { text } = status.ciSection([pr(544, H544)], [run(3, H544, { status: 'in_progress', conclusion: '' })], 'gh run list', AT, 100)
      expect(text).toContain('in_progress')
      expect(text).not.toContain('completed/')
    })

    it('shows a cancelled run as cancelled: it is not a green and not a red', () => {
      const { text } = status.ciSection([pr(544, H544)], [run(4, H544, { conclusion: 'cancelled' })], 'gh run list', AT, 100)
      expect(text).toContain('completed/cancelled')
    })
  })

  describe('runs in flight', () => {
    it('lists only runs that are not finished, and says whether their head is still an open PR\'s', () => {
      const runs = [
        run(10, H544, { status: 'in_progress', conclusion: '' }),
        run(11, H544_OLD, { status: 'pending', conclusion: '' }),
        run(12, H543, { status: 'queued', conclusion: '' }),
        run(13, H543, { status: 'completed' }),
      ]
      const { text } = status.inFlightSection([pr(544, H544), pr(543, H543)], runs, 'gh run list', AT)
      const lines = text.split('\n').filter(l => l.startsWith('run '))
      expect(lines.map(l => l.split(' ')[1])).toEqual(['10', '11', '12'])
      expect(lines[0]).toContain('an open PR head')
      expect(lines[1]).toContain("NOT an open PR's head now")
    })

    it('does not call a push to main "superseded": after a merge those runs are the suites of the commits now on main', () => {
      // Found the first time this ran for real, five minutes after eight merges: every run in flight was a push to
      // main, and each was labelled as a stale PR head.
      const runs = [run(20, H543, { status: 'in_progress', conclusion: '', event: 'push', headBranch: 'main' })]
      const { text } = status.inFlightSection([], runs, 'gh run list', AT)
      expect(text).toContain('a push to main (the suite for a commit now on main)')
      expect(text).not.toContain('NOT an open PR')
    })

    it('says "(none)" when nothing is running', () => {
      expect(status.inFlightSection([pr(544, H544)], [run(13, H544)], 'gh run list', AT).text).toContain('(none)')
    })
  })

  describe('the ledger section', () => {
    it('prints, for each open PR, its head, then each PASS with the message id, who, when, the verdict against the head, and what SHA it named', () => {
      const prs = [pr(544, H544)]
      const { text } = status.ledgerSection(prs, status.passLedger(messages, new Map([[544, H544]])), 'the room database', AT)
      expect(text).toContain(`#544  head ${H544}`)
      expect(text).toMatch(/#3144 {2}Idris {2}\d{4}-\d\d-\d\dT\d\d:\d\dZ {2}MATCH {2}da3e6283d314f4f2720462d4d0b0cade557c7ec8/)
      expect(text).toMatch(/#3134 {2}Idris .* STALE {2}96964667b5414d1b6e3548de146cb2e196804c84/)
      expect(text).toContain('Evidence, not a verdict')
    })

    it('says a PR has no PASS, and that an unknown format would also read that way', () => {
      const { text } = status.ledgerSection([pr(999, 'a'.repeat(40))], status.passLedger(messages, new Map([[999, 'a'.repeat(40)]])), 'the room database', AT)
      expect(text).toContain('no PASS verdict found in the room record')
      expect(text).toContain('would also show here')
    })
  })
})

describe('the whole report', () => {
  const MAIN = 'f6007be6b6bb6766da6d78770539059c271ef004'
  const ROOM = '15f44194-e907-403e-977c-3e1ba1f81a1a'
  const prsJson = JSON.stringify([
    { number: 544, headRefOid: H544, mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', headRefName: 'fix/x', isDraft: false },
  ])
  const runsJson = JSON.stringify([run(37123672372, H544, { attempt: 2 })])
  const roomRows = JSON.stringify(messages.filter(m => m.seq === 3144 || m.seq === 3134))

  /** A recording stub: every command goes through it, so what the tool ran can be asserted. */
  function stub(over: Partial<Record<'main' | 'prs' | 'runs' | 'sqlite', () => string>> = {}) {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const fn = (cmd: string, args: string[]): string => {
      calls.push({ cmd, args })
      if (cmd === 'gh' && args[0] === 'api') return (over.main ?? (() => MAIN + '\n'))()
      if (cmd === 'gh' && args[0] === 'pr') return (over.prs ?? (() => prsJson))()
      if (cmd === 'gh' && args[0] === 'run') return (over.runs ?? (() => runsJson))()
      if (cmd === 'sqlite3') return (over.sqlite ?? (() => roomRows))()
      throw new Error(`unexpected command ${cmd}`)
    }
    return { fn, calls }
  }

  it('prints every section, each with its source and time, and exits clean when all were read', () => {
    const { fn } = stub()
    const r = status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: ROOM }, () => AT)
    expect(r.ok).toBe(true)
    for (const title of ['== main', '== open PRs', '== CI per open head', '== runs in flight', '== PASS ledger']) expect(r.text).toContain(title)
    expect(r.text.match(/as of 14:10Z/g)).toHaveLength(5)
    expect(r.text).toContain(MAIN)
    expect(r.text).toContain('#544  run 37123672372 attempt 2')
  })

  it('says NOT READ with the reason, still prints the sections it could read, and fails', () => {
    const { fn } = stub({
      prs: () => {
        throw new Error('gh: HTTP 401: Bad credentials\nmore detail')
      },
    })
    const r = status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: ROOM }, () => AT)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('== open PRs')
    expect(r.text).toContain('NOT READ: gh: HTTP 401: Bad credentials')
    // The sections that need the PR list say so rather than printing an empty list.
    expect(r.text).toMatch(/== CI per open head[^\n]*\nNOT READ: the open PR list was not read/)
    expect(r.text).toMatch(/== PASS ledger[^\n]*\nNOT READ: the open PR list was not read/)
    // The one that did not depend on it is still there.
    expect(r.text).toContain(MAIN)
  })

  it('refuses a main that is not a 40-character SHA instead of printing whatever came back', () => {
    const r = status.buildReport(stub({ main: () => '<html>rate limited</html>' }).fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: ROOM }, () => AT)
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/== main[^\n]*\nNOT READ: expected a 40-character SHA/)
  })

  it('says NOT CONFIGURED, as a different fact from "no PASS found", when the room database is not named', () => {
    const { fn, calls } = stub()
    const r = status.buildReport(fn, {}, () => AT)
    expect(r.text).toContain('NOT CONFIGURED: set OBSRV_ROOM_DB to the room database file, and OBSRV_ROOM_ID')
    expect(r.text).toContain('This is NOT "no PASS found"')
    expect(r.text).not.toContain('no PASS verdict found')
    expect(calls.some(c => c.cmd === 'sqlite3')).toBe(false)
    // It is a state the caller chose, not a failure to read.
    expect(r.ok).toBe(true)
  })

  it('is NOT CONFIGURED without a room too: a PR number in another room\'s PASS must not become a row', () => {
    const { fn, calls } = stub()
    const r = status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db' }, () => AT)
    expect(r.text).toContain('NOT CONFIGURED: set OBSRV_ROOM_ID to the id of the room that talks about this repository')
    expect(r.text).toContain('This is NOT "no PASS found"')
    expect(r.text).not.toContain('no PASS verdict found')
    expect(calls.some(c => c.cmd === 'sqlite3')).toBe(false)
    expect(r.ok).toBe(true)
  })

  it('reads every room only when asked to, with OBSRV_ROOM_ID=all', () => {
    const { fn, calls } = stub()
    const r = status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: 'all' }, () => AT)
    expect(r.text).toContain('== PASS ledger  (room database, all rooms, as of 14:10Z)')
    expect(calls.find(c => c.cmd === 'sqlite3')!.args[3]).not.toContain('room_id')
  })

  it('opens the room database read-only, matches PASS case-sensitively, and only for the room asked for', () => {
    const { fn, calls } = stub()
    status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: '15f44194-e907-403e-977c-3e1ba1f81a1a' }, () => AT)
    const q = calls.find(c => c.cmd === 'sqlite3')!
    expect(q.args.slice(0, 2)).toEqual(['-readonly', '-json'])
    expect(q.args[2]).toBe('/x.db')
    expect(q.args[3]).toContain("GLOB '*PASS*'")
    expect(q.args[3]).toContain("m.room_id = '15f44194-e907-403e-977c-3e1ba1f81a1a'")
  })

  it('refuses a room id that is not a plausible id rather than putting it in a query', () => {
    const { fn, calls } = stub()
    const r = status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: "x' OR 1=1 --" }, () => AT)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('NOT READ: OBSRV_ROOM_ID is not a plausible room id')
    expect(calls.some(c => c.cmd === 'sqlite3')).toBe(false)
  })

  it('only ever READS: no command it runs can change anything', () => {
    const { fn, calls } = stub()
    status.buildReport(fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: ROOM }, () => AT)
    expect(calls.length).toBeGreaterThan(0)
    const verbs = calls.map(c => `${c.cmd} ${c.args.slice(0, 2).join(' ')}`)
    for (const v of verbs) expect(v).toMatch(/^(gh api repos\/|gh pr list|gh run list|sqlite3 -readonly)/)
    for (const c of calls) {
      const all = [c.cmd, ...c.args].join(' ')
      // gh api defaults to GET; a method flag or a field would make it a write.
      expect(all).not.toMatch(/(-X|--method|--field|-f |-F |--input)/)
      expect(all).not.toMatch(/\b(merge|approve|review|rerun|cancel|close|comment|edit|delete|create)\b/i)
    }
  })

  it('prints no "ready" or "safe" flag anywhere: it is evidence and the verdict has an owner', () => {
    const r = status.buildReport(stub().fn, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: ROOM }, () => AT)
    expect(r.text).not.toMatch(/\b(ready|safe to|OK to|good to go|approved)\b/i)
  })
})

describe('running a command', () => {
  it('returns stdout', () => {
    expect(status.defaultRun(process.execPath, ['-e', 'process.stdout.write("hello")'])).toBe('hello')
  })

  it('reports a failure as what the command itself said, not as Node\'s "Command failed: <the whole command line>"', () => {
    expect(() => status.defaultRun(process.execPath, ['-e', 'console.error("unable to open database file\\nsecond line");process.exit(3)'])).toThrow(/^unable to open database file$/)
  })

  it('says a missing program is missing, which is a different fact from it failing', () => {
    expect(() => status.defaultRun('definitely-not-a-program-xyz', [])).toThrow('definitely-not-a-program-xyz is not installed or not on PATH')
  })
})

describe('reading the room database', () => {
  const rows = (cmd: string, args: string[]): string => {
    seen.push({ cmd, args })
    return '[]'
  }
  const seen: Array<{ cmd: string; args: string[] }> = []

  it('does not default to every room: with no room named, the function itself refuses', () => {
    // The report checks this first, but the reader must not rely on its caller to keep PR numbers from another
    // room's talk out of the ledger.
    expect(() => status.readRoomMessages(rows, { OBSRV_ROOM_DB: '/x.db' })).toThrow('OBSRV_ROOM_ID is not a plausible room id')
  })

  it('reads every room only for "all", and one room for a room id', () => {
    seen.length = 0
    status.readRoomMessages(rows, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: 'all' })
    status.readRoomMessages(rows, { OBSRV_ROOM_DB: '/x.db', OBSRV_ROOM_ID: '15f44194-e907-403e-977c-3e1ba1f81a1a' })
    expect(seen[0]!.args[3]).not.toContain('room_id')
    expect(seen[1]!.args[3]).toContain("m.room_id = '15f44194-e907-403e-977c-3e1ba1f81a1a'")
  })
})
