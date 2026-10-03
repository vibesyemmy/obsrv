import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

afterEach(() => {
  for (const p of started.splice(0)) p.kill('SIGKILL')
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
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
  })

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
  })

  it('announces a new sha over SSE when the ref moves', async () => {
    const f = fixture()
    const { url } = await serve(f.clone, ['--interval-ms', '400'])
    const first = (await (await fetch(`${url}/data.json`)).json()).columns
      .flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title))
    expect(first).not.toContain('The second card')

    f.push('second', 'The second card')

    const seen = await until(
      'the new card is served',
      async () => {
        const d = await (await fetch(`${url}/data.json`, { cache: 'no-store' })).json()
        return d.columns.flatMap((c: { cards: Array<{ title: string }> }) => c.cards.map(k => k.title)) as string[]
      },
      t => t.includes('The second card'),
    )
    expect(seen).toContain('The first card')
  })

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
  })
})
