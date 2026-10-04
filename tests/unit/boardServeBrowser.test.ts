import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import type { Readable } from 'node:stream'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `scripts/board-serve.js` driven the way a reader meets it: a real server against a real
 * bare repository, and a real headless Chromium painting the page it serves.
 *
 * WHY THIS FILE EXISTS. `boardServe.test.ts` reads the page as a STRING. It asserts that the
 * source contains `function paint(DATA)` and `window.__boardPaint`, and it polls `/data.json`
 * to see that the server rebuilt; it never runs `paint()` and never holds `/events` for the
 * channel that carries the repaint. Gating #549 found that **deleting the line that clears
 * `#cols`, deleting the `window.__boardPaint` assignment, clearing the lane before it is
 * painted, or never painting the mentions sentence all left every one of those tests green**,
 * while a browser showed 340 cards for 170 on the first paint. The risk the PR itself named
 * ("a repaint that leaves anything uncleared stacks duplicates") was the one with no test.
 *
 * Each test below is tied to a sabotage it must catch, named in its comment; the sabotage is
 * the check that the test is about the claim and not about a string.
 *
 * Needs Chromium (`npx playwright install chromium`, which CI runs before the unit step and
 * `npm run test:browser` already requires). Headless and loopback-only: it opens no window
 * and takes no focus.
 */

const ROOT = join(__dirname, '..', '..')
type Child = ChildProcessByStdio<null, Readable, Readable>
const servers: Child[] = []
const silent: Server[] = []
const dirs: string[] = []
const TEST_MS = 90_000
let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})
afterEach(async () => {
  for (const p of servers.splice(0)) p.kill('SIGKILL')
  for (const s of silent.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const card = (title: string, extra: Record<string, string> = {}) => {
  const fields = { column: 'backlog', kind: 'chore', order: '10', ...extra }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\ntitle: ${JSON.stringify(title)}\n${lines.join('\n')}\n---\n\nEvidence for ${title}.\n`
}

/** A bare remote, a clone the server reads, and a clone the test pushes from. 40 cards, so the page scrolls. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'board-serve-browser-'))
  dirs.push(base)
  const bare = join(base, 'remote.git')
  const clone = join(base, 'clone')
  const pusher = join(base, 'pusher')
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', pusher], { stdio: 'ignore' })
  mkdirSync(join(pusher, 'board'), { recursive: true })
  for (let i = 0; i < 40; i++) writeFileSync(join(pusher, 'board', `filler-${String(i).padStart(2, '0')}.md`), card(`Filler card ${i}`))
  git(pusher, ['add', '-A'])
  git(pusher, ['commit', '-q', '-m', 'seed'])
  git(pusher, ['remote', 'add', 'origin', bare])
  git(pusher, ['push', '-q', 'origin', 'main'])
  execFileSync('git', ['clone', '-q', bare, clone], { stdio: 'ignore' })
  let n = 0
  return {
    base,
    clone,
    /** Commit `files` (a null value deletes the file) on top of main and push; returns the short sha. */
    push(files: Record<string, string | null>) {
      git(pusher, ['pull', '-q', '--rebase', 'origin', 'main'])
      for (const [name, body] of Object.entries(files)) {
        const f = join(pusher, 'board', name)
        if (body === null) rmSync(f, { force: true })
        else writeFileSync(f, body)
      }
      git(pusher, ['add', '-A'])
      git(pusher, ['commit', '-q', '-m', `edit ${++n}`])
      git(pusher, ['push', '-q', 'origin', 'HEAD:main'])
      return git(pusher, ['rev-parse', '--short=9', 'HEAD']).trim()
    },
    /** Publish main's tip under another branch name (any name git accepts, hostile ones included). */
    branch(name: string) {
      git(pusher, ['push', '-q', 'origin', `HEAD:refs/heads/${name}`])
    },
    /** A branch whose `board/` holds no cards at all. */
    emptyBoardBranch(name: string) {
      git(pusher, ['checkout', '-q', '-b', name])
      git(pusher, ['rm', '-rq', 'board'])
      mkdirSync(join(pusher, 'board'), { recursive: true })
      writeFileSync(join(pusher, 'board', '.gitkeep'), '')
      git(pusher, ['add', '-A', '-f'])
      git(pusher, ['commit', '-q', '-m', 'no cards'])
      git(pusher, ['push', '-q', 'origin', name])
      git(pusher, ['checkout', '-q', 'main'])
    },
  }
}

async function serve(clone: string, extra: string[] = []) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'board-serve.js'), '--repo', clone, '--port', '0', '--interval-ms', '300', ...extra], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as Child
  servers.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  const t0 = Date.now()
  const stop = t0 + 20_000
  while (Date.now() < stop) {
    const m = out.match(/listening (http:\/\/127\.0\.0\.1:\d+)/)
    if (m) return { url: m[1]!, listeningAfterMs: Date.now() - t0, line: out.split('\n')[0]! }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`board-serve never printed its listening line; stdout so far: ${JSON.stringify(out)}`)
}

/** The first frame of `/events`: what a client that connects now is told. */
async function firstEvent(url: string): Promise<{ sha: string; builtAt: number; error: string }> {
  const res = await fetch(`${url}/events`)
  const reader = res.body!.getReader()
  const chunk = await reader.read()
  void reader.cancel()
  const text = new TextDecoder().decode(chunk.value)
  const data = text.split('\n').filter(l => l.startsWith('data:')).pop()!
  return JSON.parse(data.slice(5))
}

async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, ms = 25_000): Promise<T> {
  const stop = Date.now() + ms
  let last: T | undefined
  while (Date.now() < stop) {
    last = await read()
    if (ok(last)) return last
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`${what} never became true; last value ${JSON.stringify(last)}`)
}

const snap = (page: Page) =>
  page.evaluate(() => {
    const ids = [...document.querySelectorAll('#cols .card .id')].map(e => e.textContent ?? '')
    return {
      ids,
      unique: new Set(ids).size,
      columns: document.querySelectorAll('#cols .col').length,
      feeds: document.querySelectorAll('#feed').length,
      liveScripts: document.querySelectorAll('script#board-live').length,
      feed: document.getElementById('feed')?.textContent ?? '',
      stamp: document.getElementById('stamp')?.textContent ?? '',
      scrollY: Math.round(window.scrollY),
      dialogOpen: (document.getElementById('dlg') as HTMLDialogElement | null)?.open ?? false,
      painter: typeof (window as unknown as { __boardPaint?: unknown }).__boardPaint,
      lane: {
        sections: document.querySelectorAll('#lane').length,
        headings: document.querySelectorAll('#lane h2').length,
        heading: document.querySelector('#lane h2')?.textContent ?? '',
        asks: [...document.querySelectorAll('#lane li .ask')].map(e => e.textContent ?? ''),
        empties: document.querySelectorAll('#lane .empty').length,
        blurbs: [...document.querySelectorAll('#lane p.blurb')].map(e => e.textContent ?? ''),
      },
    }
  })

const onPage = async (url: string) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(url)
  await page.waitForFunction(() => document.querySelectorAll('#cols .card').length > 0, undefined, { timeout: 20_000 })
  return { page, errors }
}

describe('board-serve in a browser', () => {
  it(
    'repaints in place: each pushed card appears once, scroll and an open card survive, nothing accumulates',
    async () => {
      // Catches: `cols.textContent = ''` deleted from paint() (cards stack: 340 for 170 on first connect);
      // `window.__boardPaint = paint` deleted (the live client throws on every repaint).
      const f = fixture()
      const { url } = await serve(f.clone)
      const { page, errors } = await onPage(url)

      const first = await until('the live client has repainted once', () => snap(page), s => /^Live: repainted/.test(s.feed))
      expect(first.painter).toBe('function')
      expect(first.ids.length).toBe(40)
      expect(first.unique).toBe(first.ids.length)
      expect(first.feeds).toBe(1)
      expect(first.liveScripts).toBe(1)

      await page.evaluate(() => window.scrollTo(0, 300))
      await page.locator('#cols .card').nth(2).click()
      const before = await snap(page)
      expect(before.scrollY).toBeGreaterThan(50)
      expect(before.dialogOpen).toBe(true)

      const sha = f.push({ 'zz-one.md': card('probe card one') })
      await until('the pushed card is painted', () => snap(page), s => s.ids.includes('zz-one'))
      const after = await until('the feed names the new sha', () => snap(page), s => s.feed.includes(sha))
      expect(after.ids.length).toBe(41)
      expect(after.unique).toBe(41)
      expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(2)
      expect(after.dialogOpen).toBe(true)

      let last = ''
      for (let i = 0; i < 5; i++) last = f.push({ [`zz-burst-${i}.md`]: card(`burst ${i}`) })
      const burst = await until('the burst is painted', () => snap(page), s => s.feed.includes(last))
      expect(burst.ids.length).toBe(46)
      expect(burst.unique).toBe(46)
      expect(burst.columns).toBe(first.columns)
      expect(burst.feeds).toBe(1)
      expect(burst.liveScripts).toBe(1)
      expect(errors).toEqual([])
    },
    TEST_MS,
  )

  it(
    'names the ref it follows in the painted page, before and after a repaint',
    async () => {
      // The stamp's sentence was only ever checked as source text, so taking the "every push to main"
      // branch of paint() still passed. Read it from the DOM.
      const f = fixture()
      const { url } = await serve(f.clone)
      const { page } = await onPage(url)
      for (const phase of ['first paint', 'after a repaint']) {
        if (phase === 'after a repaint') {
          const sha = f.push({ 'zz-stamp.md': card('stamp probe') })
          await until('repainted', () => snap(page), s => s.feed.includes(sha))
        }
        const s = await snap(page)
        expect(s.stamp, phase).toContain('rebuilt when origin/main moves')
        expect(s.stamp, phase).toContain('not main unless that is main')
        expect(s.stamp, phase).not.toContain('every push to main')
      }
    },
    TEST_MS,
  )

  it(
    'paints the lane through paint(): an ask adds an entry, a mention is counted, resolving them says none recorded, an ask returning shows alone',
    async () => {
      // Catches: the lane not cleared before it is painted (a second lane stacks under the first);
      // the mentions sentence never painted; the empty line left beside a returning ask.
      const f = fixture()
      const { url } = await serve(f.clone)
      const { page, errors } = await onPage(url)
      const ask = (title: string, column: string, waiting: string) => card(title, { column, waiting: JSON.stringify(waiting), owner: 'Idris' })

      const none = await until('the lane is painted', () => snap(page), s => s.lane.headings === 1)
      expect(none.lane.heading).toBe('Awaiting Opeyemi · none recorded')
      expect(none.lane.empties).toBe(1)

      f.push({ 'zz-ask-one.md': ask('first ask', 'doing', 'Opeyemi: first thing') })
      const one = await until('one ask in the lane', () => snap(page), s => s.lane.asks.length === 1)
      expect(one.lane).toMatchObject({ sections: 1, headings: 1, empties: 0, asks: ['first thing'] })
      expect(one.lane.heading).toBe('Awaiting Opeyemi · 1')

      f.push({ 'zz-ask-two.md': ask('second ask', 'next', 'Opeyemi: second thing') })
      const two = await until('two asks in the lane', () => snap(page), s => s.lane.asks.length === 2)
      expect(two.lane.sections).toBe(1)
      expect(two.lane.headings).toBe(1)
      expect(two.lane.heading).toBe('Awaiting Opeyemi · 2')

      f.push({ 'zz-mention.md': ask('only mentions him', 'doing', 'Idris: Opeyemi asked for this') })
      const mention = await until('the mentions sentence', () => snap(page), s => s.lane.blurbs.some(b => /mention/.test(b)))
      expect(mention.lane.asks.length).toBe(2)
      expect(mention.lane.blurbs.filter(b => /1 more waiting line mentions him/.test(b))).toHaveLength(1)

      // The entry opens the CURRENT card after several repaints (the id lookup is rebuilt per paint).
      await page.locator('#lane li', { hasText: 'second thing' }).click()
      expect(await page.evaluate(() => document.getElementById('dtitle')?.textContent)).toBe('second ask')
      await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).close())

      const gone = (name: string, title: string, column: string) => ({ [name]: ask(title, column, 'ci: moved on') })
      f.push({ ...gone('zz-ask-one.md', 'first ask', 'doing'), ...gone('zz-ask-two.md', 'second ask', 'next'), ...gone('zz-mention.md', 'only mentions him', 'doing') })
      const empty = await until('the lane empties', () => snap(page), s => /none recorded/.test(s.lane.heading))
      expect(empty.lane).toMatchObject({ sections: 1, headings: 1, empties: 1, asks: [] })
      expect(empty.lane.blurbs.some(b => /mention/.test(b))).toBe(false)

      f.push({ 'zz-ask-two.md': ask('second ask', 'next', 'Opeyemi: back again') })
      const back = await until('an ask returns', () => snap(page), s => s.lane.asks.length === 1)
      expect(back.lane).toMatchObject({ sections: 1, headings: 1, empties: 0, asks: ['back again'] })
      expect(errors).toEqual([])
    },
    TEST_MS,
  )

  it(
    'shows markup as text: in a card, in an ask, and in the name of the ref it follows',
    async () => {
      // Catches: the `<` escape in the embedded JSON collapsing to a literal `<`; `textContent` replaced
      // by `innerHTML`; the stamp's `[<>&]` stripping removed (a branch NAME is rendered into the page).
      const evil = '<img src=x onerror="window.__pwn=1"><b id=evilbold>x</b> & <script>window.__pwn2=1</script>'
      const f = fixture()
      const { url } = await serve(f.clone)
      const { page } = await onPage(url)
      f.push({
        'zz-evil.md': card(`t ${evil}`, { column: 'doing', owner: JSON.stringify(`o ${evil}`), waiting: JSON.stringify(`Opeyemi: ${evil}`) }),
      })
      await until('the card is painted', () => snap(page), s => s.ids.includes('zz-evil'))
      const lane = await snap(page)
      expect(lane.lane.asks).toContain(evil)
      await page.locator('#cols .card', { hasText: 'zz-evil' }).first().click()
      const inert = await page.evaluate(() => ({
        pwn: (window as unknown as { __pwn?: unknown }).__pwn ?? null,
        pwn2: (window as unknown as { __pwn2?: unknown }).__pwn2 ?? null,
        bold: !!document.getElementById('evilbold'),
        img: [...document.querySelectorAll('img')].some(i => i.getAttribute('src') === 'x'),
      }))
      expect(inert).toEqual({ pwn: null, pwn2: null, bold: false, img: false })

      // A branch whose NAME is markup: git accepts `<`, `>` and `=` in a ref.
      const hostile = '<img/src=x/onerror=window.__pwn=1>'
      f.branch(hostile)
      const second = await serve(f.clone, ['--ref', `origin/${hostile}`])
      const { page: p2 } = await onPage(second.url)
      const stamp = await until('the stamp is painted', () => snap(p2), s => s.stamp.length > 0)
      expect(stamp.stamp).toContain('img/src=x/onerror=window.__pwn=1')
      const hostileDom = await p2.evaluate(() => ({ pwn: (window as unknown as { __pwn?: unknown }).__pwn ?? null, imgs: document.querySelectorAll('img').length }))
      expect(hostileDom).toEqual({ pwn: null, imgs: 0 })
    },
    TEST_MS,
  )

  it(
    'refuses a ref whose board/ holds no cards, with the reason, instead of serving an empty board',
    async () => {
      // Catches: the zero-card guard removed. A missing board/ is stopped by `git archive` failing; a board/
      // that exists and holds no cards is not, so this is the case that guard alone covers.
      const f = fixture()
      f.emptyBoardBranch('nocards')
      const { url } = await serve(f.clone, ['--ref', 'origin/nocards'])
      const frame = await until('an error frame', () => firstEvent(url), e => e.error !== '')
      expect(frame.error).toMatch(/has no cards in board\/ at [0-9a-f]{9}/)
      expect((await fetch(url)).status).toBe(503)
    },
    TEST_MS,
  )

  it(
    'resolving a bare --ref does not hold the port back when the remote never answers',
    async () => {
      // Catches: `resolveRef` running `git ls-remote` with execFileSync and no timeout BEFORE `listen()`. For a bare
      // name (or a branch with slashes in it) that is the one network call made at startup, so a remote that accepts
      // and never answers means no port, no page and nothing to say why: the failure the async fetch was meant to end,
      // reached by a different door. `--ref origin/main` (a configured remote) skips the call and is covered above.
      const f = fixture()
      const hang = createServer(sock => sock.on('error', () => {}))
      silent.push(hang)
      await new Promise<void>(r => hang.listen(0, '127.0.0.1', r))
      const port = (hang.address() as { port: number }).port
      git(f.clone, ['remote', 'set-url', 'origin', `git://127.0.0.1:${port}/repo`])
      const { listeningAfterMs } = await serve(f.clone, ['--ref', 'main', '--fetch-timeout-ms', '1000'])
      expect(listeningAfterMs).toBeLessThan(8_000)
    },
    TEST_MS,
  )

  it(
    'a --ref shaped like an option is never run as one',
    async () => {
      // Catches: the branch handed to `git fetch <remote> <branch>` unguarded. Git reads `--upload-pack=<cmd>` after the
      // remote as an OPTION and runs <cmd> (plain `git fetch origin '--upload-pack=touch M'` creates M; with `--` before
      // the positionals it is an invalid refspec instead). It used to be stopped, by accident, by the `ls-remote`
      // existence check that startup no longer makes. Git itself says such a name is not a valid branch name, so refusing
      // a leading `-` (and passing `--`) loses nothing.
      const f = fixture()
      const marker = join(f.base, 'RAN_AS_AN_OPTION')
      const { url } = await serve(f.clone, ['--ref', `--upload-pack=touch ${marker}`, '--fetch-timeout-ms', '3000'])
      // Give the first poll time to run (it is bounded by the fetch timeout), then look for the marker.
      await until('the first poll has reported', () => firstEvent(url), e => e.error !== '', 15_000).catch(() => undefined)
      expect(existsSync(marker)).toBe(false)
    },
    TEST_MS,
  )

  it(
    'a remote that never answers does not stop it listening, and the page says it timed out',
    async () => {
      // Catches: the fetch timeout removed (the server would never leave its first poll), and `poll()`
      // moved back before `listen()`.
      const f = fixture()
      const hang = createServer(sock => sock.on('error', () => {}))
      silent.push(hang)
      await new Promise<void>(r => hang.listen(0, '127.0.0.1', r))
      const port = (hang.address() as { port: number }).port
      git(f.clone, ['remote', 'set-url', 'origin', `git://127.0.0.1:${port}/repo`])
      const { url, listeningAfterMs } = await serve(f.clone, ['--fetch-timeout-ms', '500'])
      expect(listeningAfterMs).toBeLessThan(5_000)
      const frame = await until('the timeout is reported', () => firstEvent(url), e => e.error !== '', 40_000)
      expect(frame.error).toMatch(/ETIMEDOUT|timed out|timeout/i)
    },
    TEST_MS,
  )
})
