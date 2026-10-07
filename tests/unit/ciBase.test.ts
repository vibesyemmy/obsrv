import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * `scripts/ci-base.sh` decides which commit the `scope` job and the register job diff the merge
 * commit against. It replaced `github.event.pull_request.base.sha`, which a push to a PR after
 * the base had moved leaves on the OLD tip: #608 (one board card, 2026-10-07) was told it touched
 * `docs/e2e-flakes.md` because #605 had landed on `main` in between, and took a macOS runner.
 *
 * Real repositories with real merge commits, because the thing being decided is a property of
 * how those commits are shaped. Each case has the OLD answer computed beside the new one, so a
 * case that "passes" because the old logic passed too shows up as a control that does not differ.
 */

const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'ci-base.sh')
const CI = join(ROOT, '.github', 'workflows', 'ci.yml')
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-base-'))
  dirs.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  const write = (path: string, body: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  const commit = (message: string, files: Record<string, string>): string => {
    for (const [p, b] of Object.entries(files)) write(p, b)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', message)
    return git(dir, 'rev-parse', 'HEAD')
  }
  /** What `refs/pull/N/merge` is: a merge commit of the base tip and the head, first parent the tip. */
  const mergeCommit = (tip: string, head: string): string => {
    git(dir, 'checkout', '-q', '--detach', tip)
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge head into tip', head)
    return git(dir, 'rev-parse', 'HEAD')
  }
  const branchFrom = (at: string, name: string) => git(dir, 'checkout', '-q', '-B', name, at)
  const base = (event: string, sha: string, head: string, before = ''): string =>
    execFileSync('bash', [SCRIPT, event, sha, head, before], { cwd: dir, encoding: 'utf8' })
  const files = (from: string, to: string): string[] => git(dir, 'diff', '--name-only', from, to).split('\n').filter(Boolean)
  return { dir, commit, mergeCommit, branchFrom, base, files, git: (...a: string[]) => git(dir, ...a) }
}

const SEED = {
  'board/a.md': 'card\n',
  'src/x.ts': 'export const x = 1\n',
  'docs/e2e-flakes.md': 'register\n',
  'docs/public-shape.json': '{}\n',
  'docs/breaking-changes.md': 'none\n',
}

describe('the base a pull request is diffed against is its merge commit\'s first parent', () => {
  it('an overtaken board-only PR lists the card and nothing main gained since (the #608 case)', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    r.branchFrom(c0, 'pr')
    const head = r.commit('edit the card', { 'board/a.md': 'card, edited\n' })
    r.git('checkout', '-q', 'main')
    const c1 = r.commit('main gains the register', { 'docs/e2e-flakes.md': 'register, longer\n' })
    const merge = r.mergeCommit(c1, head)

    // The control: the old logic, with the event payload's base left on the tip it had at the first push.
    expect(r.files(c0, merge), 'the old base lists what main gained').toEqual(['board/a.md', 'docs/e2e-flakes.md'])

    const base = r.base('pull_request', merge, head)
    expect(base).toBe(c1)
    expect(r.files(base, merge)).toEqual(['board/a.md'])
  })

  it('a PR that carries a code file still lists it, so the full suite still runs', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    r.branchFrom(c0, 'pr')
    const head = r.commit('code and card', { 'board/a.md': 'card, edited\n', 'src/x.ts': 'export const x = 2\n' })
    r.git('checkout', '-q', 'main')
    const c1 = r.commit('main moves', { 'docs/e2e-flakes.md': 'register, longer\n' })
    const merge = r.mergeCommit(c1, head)

    const base = r.base('pull_request', merge, head)
    expect(r.files(base, merge)).toEqual(['board/a.md', 'src/x.ts'])
  })

  it('a PR that merged main in and then touched only a card is still board-only', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    r.branchFrom(c0, 'pr')
    r.commit('first card edit', { 'board/a.md': 'card, edited once\n' })
    r.git('checkout', '-q', 'main')
    const c1 = r.commit('main gains code', { 'src/x.ts': 'export const x = 3\n' })
    r.branchFrom(r.git('rev-parse', 'pr'), 'pr')
    r.git('merge', '-q', '--no-ff', '-m', 'Merge main into the PR', c1)
    const head = r.commit('second card edit', { 'board/a.md': 'card, edited twice\n' })
    r.git('checkout', '-q', 'main')
    const c2 = r.commit('main moves again', { 'docs/public-shape.json': '{"a":1}\n', 'docs/breaking-changes.md': 'a\n' })
    const merge = r.mergeCommit(c2, head)

    // The merge-base reading (`git merge-base <stale base> <head>`) would list what main brought in; this does not.
    const base = r.base('pull_request', merge, head)
    expect(base).toBe(c2)
    expect(r.files(base, merge)).toEqual(['board/a.md'])
  })

  it('the shape-and-register check sees neither file when only main moved them', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    r.branchFrom(c0, 'pr')
    const head = r.commit('edit the card', { 'board/a.md': 'card, edited\n' })
    r.git('checkout', '-q', 'main')
    // A shape change landed on main and named the register in its own PR: both files moved.
    const c1 = r.commit('a shape change, named', { 'docs/public-shape.json': '{"a":1}\n', 'docs/breaking-changes.md': 'a\n' })
    const merge = r.mergeCommit(c1, head)

    expect(r.files(c0, merge), 'the old base would count main\'s shape change as this PR\'s').toContain('docs/public-shape.json')
    const base = r.base('pull_request', merge, head)
    expect(r.files(base, merge)).toEqual(['board/a.md'])
  })
})

describe('what it will not say', () => {
  it('prints nothing for a commit that is not a two-parent merge, because a smaller diff buys a quiet green', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    const c1 = r.commit('a plain commit', { 'board/a.md': 'card, edited\n' })
    expect(r.base('pull_request', c1, c1)).toBe('')
    expect(r.base('pull_request', c0, '')).toBe('')
  })

  it('prints nothing when the merge\'s second parent is not the head the event named', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    r.branchFrom(c0, 'pr')
    const head = r.commit('edit the card', { 'board/a.md': 'card, edited\n' })
    r.git('checkout', '-q', 'main')
    const c1 = r.commit('main moves', { 'docs/e2e-flakes.md': 'register, longer\n' })
    const merge = r.mergeCommit(c1, head)
    expect(r.base('pull_request', merge, c0)).toBe('')
    expect(r.base('pull_request', merge, head)).toBe(c1)
  })

  it('prints nothing for a commit that does not exist or an empty sha', () => {
    const r = repo()
    r.commit('seed', SEED)
    expect(r.base('pull_request', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '')).toBe('')
    expect(r.base('pull_request', '', '')).toBe('')
  })

  it('leaves a push event alone: the base is the event\'s own before sha', () => {
    const r = repo()
    const c0 = r.commit('seed', SEED)
    const c1 = r.commit('a push', { 'board/a.md': 'card, edited\n' })
    expect(r.base('push', c1, '', c0)).toBe(c0)
    expect(r.base('push', c1, '', '')).toBe('')
    expect(r.base('workflow_dispatch', c1, '', '')).toBe('')
  })
})

describe('both jobs take their base from it', () => {
  const ci = readFileSync(CI, 'utf8').replace(/^\s*#.*$/gm, '')

  it('the scope job and the register job call the script, and neither reads the payload\'s base.sha', () => {
    expect(ci.match(/scripts\/ci-base\.sh/g)?.length ?? 0).toBe(2)
    expect(ci).not.toContain('pull_request.base.sha')
  })
})
