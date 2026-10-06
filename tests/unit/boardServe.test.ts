import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killAndRemove } from './killAndRemove'

/**
 * `scripts/board-serve.js`: the board served over http, repainting when the ref
 * it watches moves. Driven here against a real bare repository and a real clone
 * — not a stubbed git — because the whole point of the server is that it reads
 * a COMMIT's cards rather than a working tree's, and a stub of `git archive`
 * would assert my belief about that instead of testing it.
 *
 * The clone's own `board/` is deliberately given a card the commit does not
 * have, so a server that quietly read the working tree would be caught.
 */

const ROOT = join(__dirname, '..', '..')
type Child = ChildProcessByStdio<null, Readable, Readable>
const started: Child[] = []
const dirs: string[] = []

afterEach(async () => {
  // Kill, wait for the exit, then remove with retries (see killAndRemove.ts).
  await killAndRemove(started.splice(0), dirs.splice(0))
})

function card(id: string, title: string, column = 'backlog') {
  return `---\ntitle: "${title}"\ncolumn: ${column}\nkind: chore\ncriterion: A1\norder: 10\n---\n\nEvidence for ${id}.\n`
}

/** A bare "remote" plus a clone of it, with one card committed. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'board-serve-test-'))
  dirs.push(base)
  const bare = join(base, 'remote.git')
  const work = join(base, 'work')
  const clone = join(base, 'clone')
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', work], { stdio: 'ignore' })
  mkdirSync(join(work, 'board'), { recursive: true })
  writeFileSync(join(work, 'board', 'first.md'), card('first', 'The first card'))
  git(work, ['config', 'user.email', 't@example.com'])
  git(work, ['config', 'user.name', 'Test'])
  git(work, ['add', 'board/first.md'])
  git(work, ['commit', '-m', 'first'])
  git(work, ['remote', 'add', 'origin', bare])
  git(work, ['push', '-q', 'origin', 'main'])
  execFileSync('git', ['clone', '-q', bare, clone], { stdio: 'ignore' })

  // The trap: a card that exists only in the clone's working tree.
  writeFileSync(join(clone, 'board', 'untracked.md'), card('untracked', 'Only in the working tree'))

  return {
    clone,
    /** Commit a file verbatim — used for a card the board guard must refuse. */
    pushFile(path: string, body: string, branch = 'main') {
      writeFileSync(join(work, path), body)
      git(work, ['add', path])
      git(work, ['commit', '-m', path])
      git(work, ['push', '-q', 'origin', `main:${branch}`])
    },
    /** A ref whose tip has no board/ at all. */
    pushBoardless(branch: string) {
      git(work, ['rm', '-rq', 'board'])
      git(work, ['commit', '-m', 'no board'])
      git(work, ['push', '-q', 'origin', `main:${branch}`])
      git(work, ['reset', '--hard', 'HEAD~1'])
    },
    /** Commit another card to the remote, so the watched ref moves. */
    push(id: string, title: string) {
      writeFileSync(join(work, 'board', `${id}.md`), card(id, title))
      git(work, ['add', `board/${id}.md`])
      git(work, ['commit', '-m', id])
      git(work, ['push', '-q', 'origin', 'main'])
    },
  }
}

/** Boot the server on an ephemeral port and resolve once it prints its URL. */
async function serve(repo: string, extra: string[] = []) {
  const p = spawn(process.execPath, [join(ROOT, 'scripts', 'board-serve.js'), '--repo', repo, '--port', '0', ...extra], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  started.push(p)
  const stderr: string[] = []
  p.stderr.on('data', d => stderr.push(String(d)))
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no listening line in 20s; stderr: ${stderr.join('')}`)), 20_000)
    let out = ''
    p.stdout.on('data', d => {
      out += String(d)
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    })
    p.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`exited ${code}; stderr: ${stderr.join('')}`))
    })
  })
  // The server listens before its first build, so a test that fetches straight
  // away can beat it. Wait until it has settled either way: built, or failed
  // and said why.
  const stop = Date.now() + 20_000
  while (Date.now() < stop) {
    const res = await fetch(`${url}/data.json`)
    if (res.status === 200) break
    if ((await res.text()).includes(':')) break
    await new Promise(r => setTimeout(r, 100))
  }
  return { url, stderr }
}

/** Poll a condition rather than sleep a guessed interval. */
async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000) {
  const stop = Date.now() + ms
  let last: T | undefined
  while (Date.now() < stop) {
    last = await read()
    if (ok(last)) return last
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`${what} never became true; last value ${JSON.stringify(last)}`)
}

describe('board-serve', () => {
  it('serves the ref’s cards, and not the working tree’s', async () => {
    const f = fixture()
    const { url } = await serve(f.clone)

    const data = await (await fetch(`${url}/data.json`)).json()
    const titles = data.columns.flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title))
    expect(titles).toContain('The first card')
    // The working tree's extra card is the control: if it appears, the server
    // is reading files rather than the commit, and every claim about seeing
    // other sessions' merges is void.
    expect(titles).not.toContain('Only in the working tree')
  }, 30_000)

  it('repaints through the page’s own paint(), and the page it serves is whole', async () => {
    const f = fixture()
    const { url } = await serve(f.clone)
    const html = await (await fetch(url)).text()
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('function paint(DATA)')
    expect(html).toContain('window.__boardPaint')
    // The live client is added by the server, never baked into the committed
    // page — a file:// copy carrying an EventSource would fail on open.
    expect(html).toContain('<script id="board-live">')
    const out = mkdtempSync(join(tmpdir(), 'board-serve-plain-'))
    dirs.push(out)
    execFileSync(
      process.execPath,
      ['scripts/build-board.js', '--md', join(out, 'b.md'), '--html', join(out, 'b.html')],
      { cwd: ROOT, stdio: 'ignore' },
    )
    // Scoped to the injected tag, not to the word: a CARD may legitimately
    // discuss EventSource in its prose, and that prose is embedded in the page
    // — the first version of this assertion failed on this feature's own card,
    // which is the assertion being wrong, not the page.
    expect(readFileSync(join(out, 'b.html'), 'utf8')).not.toContain('<script id="board-live">')
  }, 30_000)

  it('names the ref it follows, so a branch cannot be read as main', async () => {
    const f = fixture()
    // The fixture's remote only has main, so follow it by its full name and
    // check the page says which ref — the failure this guards is a server on a
    // BRANCH printing "rebuilt on every push to main".
    const { url } = await serve(f.clone, ['--ref', 'origin/main'])
    const data = await (await fetch(`${url}/data.json`)).json()
    expect(data.autoRef).toBe('origin/main')
    const html = await (await fetch(url)).text()
    expect(html).toContain('rebuilt when')
    expect(html).toContain('<b>not main</b> unless that is main')
  }, 30_000)

  it('says the feed is failing rather than leaving stale cards looking current', async () => {
    const f = fixture()
    const { url } = await serve(f.clone, ['--interval-ms', '400'])
    // Break the remote under it: the cards it already built stay correct, but a
    // page that says nothing here is the silence this server exists to avoid.
    rmSync(join(f.clone, '..', 'remote.git'), { recursive: true, force: true })

    const frame = await until(
      'an error frame arrives',
      async () => {
        const res = await fetch(`${url}/events`)
        const reader = res.body!.getReader()
        const chunk = await reader.read()
        reader.cancel()
        return new TextDecoder().decode(chunk.value)
      },
      text => text.includes('"error":"') && !text.includes('"error":""'),
    )
    expect(frame).toMatch(/"error":"[^"]+"/)

    // and the cards it had are still there, so the failure costs information, not the board
    const titles = (await (await fetch(`${url}/data.json`)).json()).columns
      .flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title))
    expect(titles).toContain('The first card')
  }, 30_000)

  it('announces the new sha on /events, held open across the move', async () => {
    const f = fixture()
    const { url } = await serve(f.clone, ['--interval-ms', '400'])
    // Held open ACROSS the push. The version this replaces polled /data.json,
    // so deleting announce() left it green — the headline feature had no test
    // on the channel that carries it (Dogu, #3242).
    const res = await fetch(`${url}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const opening = decoder.decode((await reader.read()).value!).split('data: ')[1] ?? ''
    const first = JSON.parse(opening) as { sha: string }

    f.push('third', 'The third card')

    let announced = ''
    const stop = Date.now() + 20_000
    while (Date.now() < stop && !announced) {
      const chunk = await reader.read()
      if (chunk.done) break
      for (const part of decoder.decode(chunk.value).split('\n\n')) {
        const line = part.split('data: ')[1]
        if (!line) continue
        const msg = JSON.parse(line)
        if (msg.sha && msg.sha !== first.sha) announced = msg.sha
      }
    }
    await reader.cancel()
    expect(announced).not.toBe('')
  }, 30_000)

  it('resolves a bare --ref to the remote, instead of silently following a local branch', async () => {
    const f = fixture()
    // `--ref main` used to fetch origin/main and then rev-parse main — the
    // LOCAL branch — so the page claimed live and never moved, with no error.
    const { url } = await serve(f.clone, ['--ref', 'main', '--interval-ms', '400'])
    expect((await (await fetch(`${url}/data.json`)).json()).autoRef).toBe('origin/main')

    f.push('fourth', 'The fourth card')

    const titles = await until(
      'a bare ref follows the remote',
      async () => {
        const d = await (await fetch(`${url}/data.json`, { cache: 'no-store' })).json()
        return d.columns.flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title)) as string[]
      },
      t => t.includes('The fourth card'),
    )
    expect(titles).toContain('The first card')
  }, 30_000)

  it('follows a branch that is not main', async () => {
    const f = fixture()
    f.pushFile('board/on-branch.md', card('on-branch', 'Only on the branch'), 'sidebranch')
    const { url } = await serve(f.clone, ['--ref', 'origin/sidebranch', '--interval-ms', '400'])
    const d = await (await fetch(`${url}/data.json`)).json()
    const titles = d.columns.flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title))
    expect(titles).toContain('Only on the branch')
    expect(d.autoRef).toBe('origin/sidebranch')
  }, 30_000)

  it('refuses a ref whose tip has no board/, instead of serving an empty board', async () => {
    const f = fixture()
    f.pushBoardless('noboard')
    const { url } = await serve(f.clone, ['--ref', 'origin/noboard', '--interval-ms', '400'])
    // It used to answer 200 with total: 0 — git archive failed, but the shell
    // pipeline's exit status was tar's, which is 0 (Idris, #3243).
    const res = await fetch(url)
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/board/)
  }, 30_000)

  it('puts the reason on the page, not the command line it ran', async () => {
    const f = fixture()
    const { url } = await serve(f.clone, ['--interval-ms', '400'])
    f.pushFile(
      'board/zz-bad.md',
      // A waiting line that names nobody: still refused after #548 widened
      // which columns may carry one.
      '---\ntitle: "A card the guard refuses"\ncolumn: backlog\nkind: chore\norder: 900\nwaiting: "no one is named here"\n---\n\nEvidence.\n',
    )

    const frame = await until(
      'the failure names its cause',
      async () => {
        const res = await fetch(`${url}/events`)
        const reader = res.body!.getReader()
        const text = new TextDecoder().decode((await reader.read()).value)
        await reader.cancel()
        return text
      },
      text => text.includes('"error":"') && !text.includes('"error":""'),
    )
    // "Command failed: node …/build-board.js --cards /var/folders/…" is the one
    // thing the author of a bad card does not need; the rule and the file name
    // were on the next line and were being dropped.
    expect(frame).not.toMatch(/"error":"Command failed/)
    expect(frame).toMatch(/zz-bad|waiting/)
  }, 30_000)
  it('keeps answering while a fetch hangs, instead of starving every request', async () => {
    const f = fixture()
    const { url } = await serve(f.clone, ['--interval-ms', '200', '--fetch-timeout-ms', '30000'])

    // A socket that ACCEPTS and never answers — the case both gates described.
    // (`ext::sleep` does not reproduce it: git rejects that transport in 14 ms,
    // so a test built on it passes against the broken server too. Measured.)
    const dead = createServer(() => {})
    await new Promise<void>(r => dead.listen(0, '127.0.0.1', r))
    const port = (dead.address() as { port: number }).port
    execFileSync('git', ['-C', f.clone, 'remote', 'set-url', 'origin', `git://127.0.0.1:${port}/x`], { stdio: 'ignore' })
    await new Promise(r => setTimeout(r, 600))

    // Each request is bounded: a blocking fetch does not refuse connections, it
    // DEFERS them, so an unbounded test is answered 30 s late and calls that a
    // pass. Starvation is a latency failure and needs a deadline to be seen.
    let answered = 0
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`${url}/data.json`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
        if (res.status === 200 && (await res.json()).total > 0) answered++
      } catch {
        // timed out: the event loop was busy inside the fetch
      }
    }
    dead.close()
    expect(answered).toBe(20)
  }, 30_000)

  it('says a --ref that names no remote and no branch is neither, rather than following nothing', async () => {
    const f = fixture()
    // `--ref upstream/main` used to fetch `origin upstream/main` and then read
    // `upstream/main`, which nothing updates: live, silent, wrong. Startup
    // cannot answer this any more — checking would be a network call before
    // listen(), which is the startup hang Idris found (#3263) — so the first
    // poll reports it, and git's own "couldn't find remote ref" is widened to
    // say that --ref may also name a remote.
    const { url } = await serve(f.clone, ['--ref', 'upstream/main', '--interval-ms', '400'])
    const frame = await until(
      'the failure explains what --ref accepts',
      async () => {
        const res = await fetch(`${url}/events`)
        const reader = res.body!.getReader()
        const text = new TextDecoder().decode((await reader.read()).value)
        await reader.cancel()
        return text
      },
      text => text.includes('"error":"') && !text.includes('"error":""'),
    )
    expect(frame).toMatch(/upstream\/main/)
    expect(frame).toMatch(/nor a branch on origin/)
  }, 30_000)

  it('refuses an option-shaped branch even when a real remote is in front of it', async () => {
    const f = fixture()
    // The second form, which a raw-value check misses: `origin/--upload-pack=…`
    // resolves to remote `origin` and branch `--upload-pack=…`, so the guard has
    // to read the RESOLVED pieces. Wren measured the bare form refused and this
    // one still creating the marker.
    const marker = join(f.clone, '..', 'RAN_AS_AN_OPTION_PREFIXED')
    const { url } = await serve(f.clone, ['--ref', `origin/--upload-pack=touch ${marker}`, '--interval-ms', '300'])
    const frame = await until(
      'the refusal reaches the page',
      async () => {
        const res = await fetch(`${url}/events`)
        const reader = res.body!.getReader()
        const text = new TextDecoder().decode((await reader.read()).value)
        await reader.cancel()
        return text
      },
      text => text.includes('"error":"') && !text.includes('"error":""'),
    )
    expect(frame).toMatch(/option/)
    expect(existsSync(marker)).toBe(false)
  }, 30_000)

})
