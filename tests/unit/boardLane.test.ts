import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The Awaiting Opeyemi lane (`feat-awaiting-lane`).
 *
 * The lane is derived: a card's own `waiting: "Opeyemi: <the ask>"` line puts it there, in whatever column it
 * sits, and nothing is ever moved into it by hand. The ways a derived lane goes wrong are the point of these
 * tests, because the redirect card showed the first one for real (2026-09-29 to 10-02, it asked him a question
 * he had already answered, and stood for about three days):
 *   - a line that outlives its answer, which is why every entry shows how old its line is, and says
 *     `age unknown` where history cannot answer rather than leaving a blank that reads as "recent";
 *   - a card that WAS waiting on him quietly missing from the page (the guard allowed the line on Doing and
 *     Review only, and the generator exported it for those two columns only), so four places change together;
 *   - a lane that omits itself when empty, which fits "nothing is waiting" and "it did not render" equally.
 *
 * `build-board.js` runs at top level and exits, so these tests run the REAL script, copied into a throwaway
 * git repository with real commit dates (the age comes from `git log`).
 */
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'build-board.js')
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

interface Run { status: number | null; stdout: string; stderr: string }

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'board-lane-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'board'))
  mkdirSync(join(dir, 'docs'))
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
    exists: (rel: string) => existsSync(join(dir, rel)),
  }
}

const card = (title: string, fm: Record<string, string> = {}, body = 'Evidence.') =>
  `---\ntitle: "${title}"\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}\n`

describe('where a waiting line is allowed', () => {
  it('allows "Opeyemi: <ask>" on a Backlog card, which the guard used to refuse', () => {
    const r = repo()
    r.write('a', card('Pick one', { column: 'backlog', waiting: '"Opeyemi: pick A or B"' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--check')
    expect(out.stderr).toContain('1 cards render')
    expect(out.status).toBe(0)
  })

  it('allows it on a Next card', () => {
    const r = repo()
    r.write('a', card('Pick one', { column: 'next', waiting: '"Opeyemi: pick A or B"' }))
    r.commit('2026-10-01T10:00:00Z')
    expect(r.run('--check').status).toBe(0)
  })

  it.each(['backlog', 'next'])('still refuses a %s line that does not say who it waits on, naming the column', column => {
    const r = repo()
    r.write('a', card('Pick one', { column, waiting: '"pick A or B"' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--check')
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain(`waiting: on a ${column === 'next' ? 'Next' : 'Backlog'} card names who it waits on, as "who: what"`)
  })

  it('still refuses a line on a Done card, and the message names the four columns that may carry one', () => {
    const r = repo()
    r.write('a', card('Closed', { column: 'done', waiting: '"Opeyemi: too late"' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--check')
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('waiting: belongs on a Doing, Review, Backlog or Next card')
  })

  it('still requires the line on a Doing card (the existing rule is unchanged)', () => {
    const r = repo()
    r.write('a', card('Moving?', { column: 'doing' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--check')
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('a Doing card needs a waiting: line')
  })
})

describe('which cards are in the lane', () => {
  function mixed() {
    const r = repo()
    r.write('backlog-ask', card('Backlog ask', { column: 'backlog', waiting: '"Opeyemi: choose the release class"', order: '1' }))
    r.write('next-ask', card('Next ask', { column: 'next', waiting: '"opeyemi: lower case still counts"', order: '2' }))
    r.write('doing-ask', card('Doing ask', { column: 'doing', owner: 'Dogu', waiting: '"Opeyemi: a time for the run"', order: '3' }))
    r.write('review-ask', card('Review ask', { column: 'review', waiting: '"Opeyemi: the OTP"', order: '4' }))
    r.write('about-him', card('About him', { column: 'backlog', waiting: '"Idris: Opeyemi asked for this"', order: '5' }))
    r.write('on-ci', card('On ci', { column: 'doing', owner: 'Dogu', waiting: '"ci: the suite"', order: '6' }))
    r.write('moving', card('Moving', { column: 'doing', owner: 'Dogu', waiting: '""', order: '7' }))
    r.write('plain', card('Plain', { column: 'backlog', order: '8' }))
    r.write('closed', card('Closed', { column: 'done', order: '9' }))
    r.commit('2026-10-01T10:00:00Z')
    return r
  }

  it('lists a card that waits on him in ANY column but Done, and nothing else', () => {
    const out = mixed().run('--lane')
    expect(out.status).toBe(0)
    const ids = out.stdout.split('\n').filter(l => l.startsWith('- ')).map(l => l.split(' ')[1]).sort()
    expect(ids).toEqual(['backlog-ask', 'doing-ask', 'next-ask', 'review-ask'])
    expect(out.stdout).toContain('Awaiting Opeyemi: 4')
  })

  it('matches on who the line is addressed TO, not on his name appearing in it', () => {
    const out = mixed().run('--lane')
    const entries = out.stdout.split('\n').filter(l => l.startsWith('- '))
    expect(entries.some(l => l.includes('about-him'))).toBe(false)
    expect(entries.some(l => l.includes('on-ci'))).toBe(false)
    // …but a line that merely MENTIONS him is named, so its author is not left believing it is listed.
    expect(out.stdout).toContain('(1 more waiting line mention him and are not listed: about-him)')
  })

  it('prints the ask and the column of each entry', () => {
    const out = mixed().run('--lane')
    expect(out.stdout).toContain('- backlog-ask [Backlog] choose the release class (')
    expect(out.stdout).toContain('- review-ask [Review] the OTP (')
  })

  it('says "none recorded" when no line names him, and says what that does and does not mean', () => {
    // NOT "none" / "nothing is waiting": an empty lane is a fact about the LINES. A card can wait on him with no
    // line written (Idris found three on the real board on day one), and "nothing is waiting" would be the
    // board's own silence presented as an answer.
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    const out = r.run('--lane').stdout
    expect(out.split('\n')[0]).toBe('Awaiting Opeyemi: none recorded')
    expect(out).toContain("No card's waiting: line names Opeyemi.")
    expect(out).toContain('A card that waits on him without a waiting: line naming him is not listed.')
    expect(out).not.toMatch(/nothing is waiting/i)
  })

  describe('lines that mention him and are not in the lane', () => {
    function odd() {
      const r = repo()
      r.write('both', card('Both', { column: 'backlog', waiting: '"Opeyemi and Henry: pick one"', order: '1' }))
      r.write('parens', card('Parens', { column: 'next', waiting: '"Opeyemi (OTP): the release"', order: '2' }))
      r.write('about', card('About', { column: 'backlog', waiting: '"Idris: Opeyemi asked for this"', order: '3' }))
      r.write('listed', card('Listed', { column: 'backlog', waiting: '"Opeyemi: choose"', order: '4' }))
      r.write('other', card('Other', { column: 'backlog', waiting: '"ci: the suite"', order: '5' }))
      r.commit('2026-10-01T10:00:00Z')
      return r
    }

    it('are counted and named, not silently omitted: their author believes they are listed', () => {
      const out = odd().run('--lane').stdout
      expect(out).toContain('(3 more waiting lines mention him and are not listed: both, parens, about)')
      expect(out).toContain('- listed [Backlog] choose')
    })

    it('are named in the board, with links, and in the page data', () => {
      const r = odd()
      r.run()
      expect(r.read('docs/board.md')).toContain('3 more `waiting:` lines mention him and are not listed, because they do not start with his name: [`both`](../board/both.md), [`parens`](../board/parens.md), [`about`](../board/about.md).')
      const raw = /const DATA = JSON\.parse\((".*")\);/.exec(r.read('docs/board.html'))![1]!
      expect((JSON.parse(JSON.parse(raw)) as { mentions: string[] }).mentions).toEqual(['both', 'parens', 'about'])
    })

    it('say nothing when there are none', () => {
      const r = repo()
      r.write('listed', card('Listed', { column: 'backlog', waiting: '"Opeyemi: choose"' }))
      r.commit('2026-10-01T10:00:00Z')
      expect(r.run('--lane').stdout).not.toContain('mention him')
    })
  })
})

describe('how old each line is', () => {
  it('is when the waiting LINE last changed, not when the card was last touched', () => {
    const r = repo()
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: first ask"' }, 'Body v1.'))
    r.commit('2026-10-01T10:00:00Z')
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: first ask"' }, 'Body v2, edited a day later.'))
    r.commit('2026-10-02T10:00:00Z')
    expect(r.run('--lane').stdout).toContain('since 2026-10-01 10:00 UTC')
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: second ask"' }, 'Body v2, edited a day later.'))
    r.commit('2026-10-03T09:00:00Z')
    expect(r.run('--lane').stdout).toContain('since 2026-10-03 09:00 UTC')
  })

  it('lists the oldest wait first, because that is the one to look at', () => {
    const r = repo()
    r.write('newer', card('Newer', { column: 'backlog', waiting: '"Opeyemi: newer ask"', order: '1' }))
    r.commit('2026-10-03T10:00:00Z')
    r.write('older', card('Older', { column: 'next', waiting: '"Opeyemi: older ask"', order: '2' }))
    r.commit('2026-09-29T10:00:00Z')
    const ids = r.run('--lane').stdout.split('\n').filter(l => l.startsWith('- ')).map(l => l.split(' ')[1])
    // `older` is committed second but with an EARLIER date, so file order and history order disagree and
    // only a sort on the age can put it first.
    expect(ids).toEqual(['older', 'newer'])
  })

  it('says "age unknown" for a line with uncommitted edits, instead of a blank or a wrong date', () => {
    const r = repo()
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: first ask"' }))
    r.commit('2026-10-01T10:00:00Z')
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: edited, not committed"' }))
    const line = r.run('--lane').stdout.split('\n').find(l => l.startsWith('- a '))!
    expect(line).toContain('age unknown')
    expect(line).not.toContain('2026-10-01')
  })

  it('puts an unknown age after the known ones', () => {
    const r = repo()
    r.write('known', card('Known', { column: 'backlog', waiting: '"Opeyemi: known"', order: '2' }))
    r.commit('2026-10-03T10:00:00Z')
    r.write('unknown', card('Unknown', { column: 'backlog', waiting: '"Opeyemi: not committed"', order: '1' }))
    const ids = r.run('--lane').stdout.split('\n').filter(l => l.startsWith('- ')).map(l => l.split(' ')[1])
    expect(ids).toEqual(['known', 'unknown'])
  })

  it('says "age unknown" in a shallow checkout, where every line would otherwise date from HEAD', () => {
    const r = repo()
    r.write('a', card('Ask', { column: 'backlog', waiting: '"Opeyemi: first ask"' }))
    r.commit('2026-09-01T10:00:00Z')
    r.write('b', card('Other', { column: 'backlog' }))
    r.commit('2026-10-03T10:00:00Z')
    const clone = join(r.dir, '..', `${r.dir.split('/').pop()}-shallow`)
    dirs.push(clone)
    const c = spawnSync('git', ['clone', '-q', '--depth', '1', `file://${r.dir}`, clone], { encoding: 'utf8' })
    expect(c.status).toBe(0)
    mkdirSync(join(clone, 'docs'), { recursive: true })
    const out = spawnSync(process.execPath, [join(clone, 'scripts', 'build-board.js'), '--lane'], { cwd: clone, encoding: 'utf8' })
    // `git add -A board scripts` committed the script too, so the shallow clone has it.
    expect(out.stdout).toContain('age unknown')
    expect(out.stdout).not.toContain('2026-10-03')
  })
})

describe('what the generated board shows', () => {
  function board() {
    const r = repo()
    r.write('ask', card('The ask', { column: 'backlog', waiting: '"Opeyemi: choose the class"', order: '1' }))
    r.write('doing-ask', card('Doing ask', { column: 'doing', owner: 'Dogu', waiting: '"Opeyemi: a time"', order: '2' }))
    r.write('plain', card('Plain', { column: 'backlog', order: '3' }))
    r.write('closed', card('Closed', { column: 'done', order: '4' }))
    r.commit('2026-10-01T10:00:00Z')
    expect(r.run().status).toBe(0)
    return r
  }

  it('writes a lane section BEFORE the columns, with a link and the ask for each entry', () => {
    const md = board().read('docs/board.md')
    const lane = md.indexOf('## Awaiting Opeyemi — 2')
    expect(lane).toBeGreaterThan(-1)
    expect(lane).toBeLessThan(md.indexOf('## Backlog —'))
    expect(md).toContain('- [`ask`](../board/ask.md) · Backlog · choose the class · since 2026-10-01 10:00 UTC')
    expect(md).toContain('- [`doing-ask`](../board/doing-ask.md) · Doing · a time · since 2026-10-01 10:00 UTC')
  })

  it('keeps the card in its own column too: the lane is a view, not a move', () => {
    const md = board().read('docs/board.md')
    expect(md).toContain('## Backlog — 2')
    expect(md).toContain('### Doing ask')
  })

  it('says the count in the summary line', () => {
    expect(board().read('docs/board.md')).toMatch(/\*4 cards, 3 open, .* Awaiting Opeyemi, by waiting line: 2\.\*/)
  })

  it('renders the section even when the lane is empty, and says "none recorded", not "nothing is waiting"', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run()
    const md = r.read('docs/board.md')
    expect(md).toContain('## Awaiting Opeyemi — none recorded')
    expect(md).toContain("No card's `waiting:` line names Opeyemi. A card that waits on him without a `waiting:` line naming him is not listed.")
    expect(md).toContain('Awaiting Opeyemi, by waiting line: none recorded.')
    expect(md).not.toMatch(/nothing is waiting on Opeyemi/i)
    expect(md).not.toContain('— 0')
  })

  it('exports the lane and the wait line of a Backlog card to the page, so a card with a line is not missing from it', () => {
    const html = board().read('docs/board.html')
    const raw = /const DATA = JSON\.parse\((".*")\);/.exec(html)![1]!
    const data = JSON.parse(JSON.parse(raw)) as {
      lane: Array<{ id: string; column: string; ask: string; waitingSince: number | null }>
      columns: Array<{ id: string; cards: Array<{ id: string; waiting: string | null }> }>
    }
    expect(data.lane.map(x => x.id).sort()).toEqual(['ask', 'doing-ask'])
    expect(data.lane.find(x => x.id === 'ask')).toMatchObject({ column: 'backlog', ask: 'choose the class' })
    expect(data.lane.find(x => x.id === 'ask')!.waitingSince).toBe(Date.parse('2026-10-01T10:00:00Z'))
    const backlog = data.columns.find(c => c.id === 'backlog')!.cards
    expect(backlog.find(c => c.id === 'ask')!.waiting).toBe('Opeyemi: choose the class')
    expect(backlog.find(c => c.id === 'plain')!.waiting).toBeNull()
    // …and a Doing card keeps its own contract: '' is moving, a line is a wait.
    expect(data.columns.find(c => c.id === 'doing')!.cards[0]!.waiting).toBe('Opeyemi: a time')
  })

  it('has a lane element in the page, filled in by the script', () => {
    const html = board().read('docs/board.html')
    expect(html).toContain('<section class="lane" id="lane"></section>')
    expect(html).toContain("'Awaiting Opeyemi · '")
  })

  it('says "none recorded" in the page too, with the same sentence as the board', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run()
    const html = r.read('docs/board.html')
    const raw = /const DATA = JSON\.parse\((".*")\);/.exec(html)![1]!
    expect((JSON.parse(JSON.parse(raw)) as { noneRecorded: string }).noneRecorded).toBe("No card's waiting: line names Opeyemi. A card that waits on him without a waiting: line naming him is not listed.")
    // The heading and the summary line each say it, so each is pinned on its own line of the script.
    expect(html).toContain("h.textContent = 'Awaiting Opeyemi · ' + (DATA.lane.length === 0 ? 'none recorded' : DATA.lane.length);")
    expect(html).toContain("' · awaiting Opeyemi, by waiting line: ' + (DATA.lane.length === 0 ? 'none recorded' : DATA.lane.length);")
    expect(html).not.toMatch(/Nothing is waiting on Opeyemi/i)
  })

  it('puts an ask into the page as TEXT: markup in it is never parsed (Idris checked in a browser; this pins the code)', () => {
    const r = repo()
    r.write('x', card('Hostile', { column: 'backlog', waiting: '"Opeyemi: <img src=x onerror=\\"window.__xss=1\\"><b>bold</b>"' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run()
    const html = r.read('docs/board.html')
    // The payload reaches the page only inside the JSON data, with `<` escaped, so it cannot close the script tag…
    expect(html).not.toContain('<img src=x')
    // …and the lane's own script assigns it with textContent, never as markup.
    const script = html.slice(html.indexOf('(function () {\n  const lane'), html.indexOf('const dlg = document.getElementById'))
    expect(script).toContain('ask.textContent = x.ask')
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) expect(script).not.toContain(sink)
  })

  it('writes NOTHING under --lane: it is a read', () => {
    const r = repo()
    r.write('plain', card('Plain', { column: 'backlog' }))
    r.commit('2026-10-01T10:00:00Z')
    r.run('--lane')
    expect(r.exists('docs/board.md')).toBe(false)
    expect(r.exists('docs/board.html')).toBe(false)
  })

  it('tells a card author how to ask him something, and that the PR that acts on the answer deletes the line', () => {
    const md = board().read('docs/board.md')
    expect(md).toContain('**Asking Opeyemi something**')
    expect(md).toContain('The pull request that acts on his answer deletes the')
  })
})

describe('the real board still renders', () => {
  it('npm run board:check passes on the cards in this repository', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: join(__dirname, '..', '..'), encoding: 'utf8' })
    expect(r.stderr).toMatch(/\d+ cards render/)
    expect(r.status).toBe(0)
  })
})
