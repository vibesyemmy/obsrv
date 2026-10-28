import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'

/**
 * The Waiting on a recurrence lane: every card that is not Done and whose
 * `waiting:` line names `event` (`waiting: "event: <what it waits on>"`), in
 * whatever column it sits. The same derived-lane shape as the Awaiting
 * Opeyemi lane (`feat-awaiting-lane`, `boardLane.test.ts`), for the opposite
 * reason it exists: Opeyemi asked for the backlog to stop reading as "12
 * things to pick up" when most of it is recurrence-waiters nobody can force,
 * and the fix is to say so on the board rather than to delete the cards.
 *
 * `build-board.js` runs at top level and exits, so these tests run the REAL
 * script, copied into a throwaway git repository — same harness as
 * `boardLane.test.ts`, duplicated rather than shared because that file
 * duplicates its own `repo()`/`card()` rather than exporting them.
 */
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'build-board.js')
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const SLOW_MS = 30_000

interface Run { status: number | null; stdout: string; stderr: string }

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'board-recurrence-lane-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'board'))
  mkdirSync(join(dir, 'docs'))
  const { copyFileSync } = require('node:fs')
  copyFileSync(SCRIPT, join(dir, 'scripts', 'build-board.js'))
  const git = (args: string[], date?: string) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    })
  git(['init', '-q', '-b', 'main'])
  return {
    dir,
    write: (id: string, text: string) => writeFileSync(join(dir, 'board', `${id}.md`), text),
    commit: (date: string, msg = 'c') => {
      git(['add', '-A', 'board', 'scripts'])
      const r = git(['commit', '-q', '-m', msg], date)
      if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`)
    },
    run: (...args: string[]): Run => {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'build-board.js'), ...args], { cwd: dir, encoding: 'utf8' })
      return { status: r.status, stdout: r.stdout, stderr: r.stderr }
    },
    read: (rel: string) => readFileSync(join(dir, rel), 'utf8'),
  }
}

const card = (title: string, fm: Record<string, string> = {}, body = 'Evidence.') =>
  `---\ntitle: "${title}"\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}\n`

describe('which cards are in the lane', () => {
  function mixed() {
    const r = repo()
    r.write('backlog-wait', card('Backlog wait', { column: 'backlog', waiting: '"event: a recurrence of the timeout"', order: '1' }))
    r.write('next-wait', card('Next wait', { column: 'next', waiting: '"EVENT: upper case still counts"', order: '2' }))
    r.write('doing-wait', card('Doing wait', { column: 'doing', owner: 'Dogu', waiting: '"event: a real hang"', order: '3' }))
    r.write('review-wait', card('Review wait', { column: 'review', waiting: '"event: a clean suite"', order: '4' }))
    r.write('on-opeyemi', card('On Opeyemi', { column: 'backlog', waiting: '"Opeyemi: pick a class"', order: '5' }))
    r.write('on-ci', card('On ci', { column: 'doing', owner: 'Dogu', waiting: '"ci: the suite"', order: '6' }))
    r.write('plain', card('Plain', { column: 'backlog', order: '7' }))
    r.write('closed', card('Closed', { column: 'done', order: '8' }))
    r.commit('2026-10-01T10:00:00Z')
    return r
  }

  it('lists a card waiting on event in ANY column but Done, and nothing else', () => {
    const out = mixed().run('--recurrences')
    expect(out.status).toBe(0)
    const ids = out.stdout.split('\n').filter(l => l.startsWith('- ')).map(l => l.split(' ')[1]).sort()
    expect(ids).toEqual(['backlog-wait', 'doing-wait', 'next-wait', 'review-wait'])
    expect(out.stdout).toContain('Waiting on a recurrence: 4')
  }, SLOW_MS)

  it('does not pick up a card waiting on Opeyemi or on ci', () => {
    const out = mixed().run('--recurrences').stdout
    const entries = out.split('\n').filter(l => l.startsWith('- '))
    expect(entries.some(l => l.includes('on-opeyemi'))).toBe(false)
    expect(entries.some(l => l.includes('on-ci'))).toBe(false)
  }, SLOW_MS)

  it('prints the ask and the column of each entry', () => {
    const out = mixed().run('--recurrences').stdout
    expect(out).toContain('- backlog-wait [Backlog] a recurrence of the timeout (')
    expect(out).toContain('- review-wait [Review] a clean suite (')
  }, SLOW_MS)

  it('says "none recorded" when no line names event', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--recurrences').stdout
    expect(out.split('\n')[0]).toBe('Waiting on a recurrence: none recorded')
  }, SLOW_MS)

  it('writes NOTHING under --recurrences: it is a read', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run('--recurrences')
    expect(() => r.read('docs/board.md')).toThrow()
  }, SLOW_MS)
})

describe('how old each line is', () => {
  it('lists the oldest wait first', () => {
    const r = repo()
    r.write('newer', card('Newer', { column: 'backlog', waiting: '"event: newer"', order: '1' }))
    r.commit('2026-10-03T10:00:00Z')
    r.write('older', card('Older', { column: 'next', waiting: '"event: older"', order: '2' }))
    r.commit('2026-09-29T10:00:00Z')
    const ids = r.run('--recurrences').stdout.split('\n').filter(l => l.startsWith('- ')).map(l => l.split(' ')[1])
    expect(ids).toEqual(['older', 'newer'])
  }, SLOW_MS)
})

describe('what the generated board shows', () => {
  function board() {
    const r = repo()
    r.write('wait', card('The wait', { column: 'backlog', waiting: '"event: a recurrence of the crash"', order: '1' }))
    r.write('doing-wait', card('Doing wait', { column: 'doing', owner: 'Dogu', waiting: '"event: a real hang"', order: '2' }))
    r.write('plain', card('Plain', { column: 'backlog', order: '3' }))
    r.write('closed', card('Closed', { column: 'done', order: '4' }))
    r.commit('2026-10-01T10:00:00Z')
    expect(r.run().status).toBe(0)
    return r
  }

  it('writes a lane section BEFORE the columns, with a link and the ask for each entry', () => {
    const md = board().read('docs/board.md')
    const lane = md.indexOf('## Waiting on a recurrence — 2')
    expect(lane).toBeGreaterThan(-1)
    expect(lane).toBeLessThan(md.indexOf('## Backlog —'))
    expect(md).toContain('- [`wait`](../board/wait.md) · Backlog · a recurrence of the crash · since 2026-10-01 10:00 UTC')
    expect(md).toContain('- [`doing-wait`](../board/doing-wait.md) · Doing · a real hang · since 2026-10-01 10:00 UTC')
  }, SLOW_MS)

  it('keeps the card in its own column too: the lane is a view, not a move', () => {
    const md = board().read('docs/board.md')
    expect(md).toContain('## Backlog — 2')
    expect(md).toContain('### Doing wait')
  }, SLOW_MS)

  it('says the count in the summary line', () => {
    expect(board().read('docs/board.md')).toMatch(/waiting on a recurrence: 2\.\*/)
  }, SLOW_MS)

  it('renders the section even when the lane is empty, and says "none recorded"', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run()
    const md = r.read('docs/board.md')
    expect(md).toContain('## Waiting on a recurrence — none recorded')
    expect(md).toContain('waiting on a recurrence: none recorded.')
  }, SLOW_MS)

  it('exports the lane to the page as JSON', () => {
    const html = board().read('docs/board.html')
    const raw = /const DATA = JSON\.parse\((".*")\);/.exec(html)![1]!
    const data = JSON.parse(JSON.parse(raw)) as {
      recurrenceLane: Array<{ id: string; column: string; ask: string; waitingSince: number | null }>
    }
    expect(data.recurrenceLane.map(x => x.id).sort()).toEqual(['doing-wait', 'wait'])
    expect(data.recurrenceLane.find(x => x.id === 'wait')).toMatchObject({ column: 'backlog', ask: 'a recurrence of the crash' })
  }, SLOW_MS)

  it('has a recurrence-lane element in the page, filled in by the script', () => {
    const html = board().read('docs/board.html')
    expect(html).toContain('<section class="lane" id="recurrenceLane"></section>')
    expect(html).toContain("'Waiting on a recurrence · '")
  }, SLOW_MS)

  it('puts an ask into the page as TEXT, never parsed as markup (same guard as the Opeyemi lane)', () => {
    const r = repo()
    r.write('x', card('Hostile', { column: 'backlog', waiting: '"event: <img src=x onerror=\\"window.__xss=1\\"><b>bold</b>"' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run()
    const html = r.read('docs/board.html')
    expect(html).not.toContain('<img src=x')
  }, SLOW_MS)
})

describe('the real board still renders', () => {
  it('npm run board:check passes on the cards in this repository', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: join(__dirname, '..', '..'), encoding: 'utf8' })
    expect(r.stderr).toMatch(/\d+ cards render/)
    expect(r.status).toBe(0)
  }, SLOW_MS)
})

/**
 * Found while manually verifying this lane in a browser, unrelated to the lane itself: `open_` (the
 * dialog a card click opens) calls `ago(x.waitingSince)` to print "waiting on X, set Y ago", but `ago`
 * is declared `const` *inside* `function paint(DATA)` while `open_` is declared outside it — out of
 * `ago`'s scope. It only throws when a real `waitingSince` reaches `open_`, which needs a card whose
 * `waiting:` line is actually committed with real git history — exactly what `boardServeBrowser.test.ts`'s
 * fixtures don't have (fast pushes to a throwaway remote, read back through board-serve's own
 * materialisation), so the existing dialog-click tests never exercised this branch. A real commit, in
 * a real git repo, loaded in a real browser is what it takes to catch it.
 */
describe('the dialog can show a real age', () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })

  it('opens without throwing, and prints how long ago the wait was set', async () => {
    const r = repo()
    r.write('old-wait', card('Old wait', { column: 'backlog', waiting: '"event: something nobody can force"' }))
    r.commit('2026-09-01T10:00:00Z')
    expect(r.run().status).toBe(0)

    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`file://${join(r.dir, 'docs', 'board.html')}`)
    await page.locator('.card', { hasText: 'Old wait' }).click()
    await page.waitForFunction(() => document.getElementById('dtitle')?.textContent === 'Old wait', { timeout: 10_000 })
    const meta = await page.locator('#dmeta').textContent()
    expect(meta, `dialog meta: ${meta}`).toMatch(/set \d+ [dh] ago|set \d+ min ago/)
    await page.close()
    expect(errors, `console/page errors: ${JSON.stringify(errors)}`).toEqual([])
  }, SLOW_MS)
})
