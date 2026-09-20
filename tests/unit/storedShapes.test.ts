import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirmsAs, isHistoryShape, isSettingsShape, isTabsShape } from '../../src/shared/storedShapes'
import { loadHistory } from '../../src/shared/historyFile'
import { loadTabs } from '../../src/shared/tabsFile'
import { parseSettings } from '../../src/shared/ipcPayloads'

/** A file in a throwaway directory, so the readers get a real path to read. */
function withFile(name: string, body: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'obsrv-shapes-'))
  try {
    const path = join(dir, name)
    writeFileSync(path, body)
    run(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('storedShapes: whether a file in the shared Electron directory is Obsrv’s', () => {
  it('refuses the content that `bug-uninstall-confirm-unenforced` was filed for', () => {
    // The exact bytes from the bug's own fixture. Before this shipped, a file
    // holding this was removed as if it were Obsrv's.
    const junk = 'not json at all, and not an array either way'
    for (const kind of ['history', 'settings', 'tabs'] as const) {
      let parsed: unknown
      let threw = false
      try {
        parsed = JSON.parse(junk)
      } catch {
        threw = true
      }
      expect(threw, 'the fixture is supposed to be unparseable; if it parses this test proves nothing').toBe(true)
      // And the caller's contract on a parse failure: `false`, never a throw.
      expect(confirmsAs(kind, parsed)).toBe(false)
    }
  })

  it('refuses another app’s file that happens to parse', () => {
    // The case the whole check exists for: valid JSON, plausible for some
    // other Electron app, nothing of Obsrv's in it.
    expect(isHistoryShape([{ title: 'a bookmark' }])).toBe(false)
    expect(isTabsShape({ tabs: [{ id: 7 }] })).toBe(false)
    expect(isSettingsShape({ theme: 'dark', windowWidth: 900 })).toBe(false)
  })

  it('refuses an empty history, deliberately, because `[]` attributes to nobody', () => {
    expect(isHistoryShape([])).toBe(false)
    // Stated as its own case so that flipping it is a decision with a test to
    // change, not a side effect of loosening the predicate.
  })

  it('accepts what Obsrv actually writes', () => {
    expect(isHistoryShape([{ url: 'https://example.com' }])).toBe(true)
    expect(isTabsShape({ tabs: [] })).toBe(true)
    expect(isTabsShape({ tabs: [{ url: 'https://example.com' }] })).toBe(true)
    expect(isSettingsShape({ hostDiagonalInches: 14, hostNits: 500 })).toBe(true)
  })

  it('refuses settings whose two required fields are present but not positive numbers', () => {
    expect(isSettingsShape({ hostDiagonalInches: 0, hostNits: 500 })).toBe(false)
    expect(isSettingsShape({ hostDiagonalInches: 14, hostNits: -1 })).toBe(false)
    expect(isSettingsShape({ hostDiagonalInches: '14', hostNits: 500 })).toBe(false)
    expect(isSettingsShape({ hostDiagonalInches: Number.NaN, hostNits: 500 })).toBe(false)
  })
})

describe('the tie to the real readers, which shared code cannot enforce here', () => {
  // `storedShapes` is deliberately STRICTER than the readers: the readers
  // forgive so the app can start, this refuses so the uninstaller cannot take
  // someone else's file. The two therefore cannot be one function — but they
  // must not drift apart either, and this is what holds them together.
  //
  // The property: anything this module calls Obsrv's must actually load as
  // Obsrv's through the real reader. If a future change to what Obsrv writes
  // breaks that, it breaks here rather than silently widening what `--remove`
  // deletes.
  //
  // **An empty tabs file is accepted where an empty history file is not**, and
  // the difference is the container. `{"tabs": []}` still carries a key Obsrv
  // chose; `[]` carries nothing at all and is what an untouched list looks
  // like in any app that stores one. So "loads non-empty" is the tie for the
  // populated cases, and the empty-container case is asserted below on its own
  // terms rather than folded into a property it does not satisfy.

  it('a history file this module accepts loads as non-empty history', () => {
    const body = JSON.stringify([{ url: 'https://example.com', count: 1, last: 1_700_000_000_000 }])
    expect(isHistoryShape(JSON.parse(body))).toBe(true)
    withFile('history.json', body, path => {
      expect(loadHistory(path).length, 'accepted by storedShapes and yet the real reader finds nothing in it').toBeGreaterThan(0)
    })
  })

  it('a tabs file this module accepts loads as tabs', () => {
    const body = JSON.stringify({ tabs: [{ url: 'https://example.com' }] })
    expect(isTabsShape(JSON.parse(body))).toBe(true)
    withFile('tabs.json', body, path => {
      expect(loadTabs(path).tabs.length).toBeGreaterThan(0)
    })
  })

  it('a settings object this module accepts parses through the real parseSettings', () => {
    const raw = { hostDiagonalInches: 14, hostNits: 500 }
    expect(isSettingsShape(raw)).toBe(true)
    expect(parseSettings(raw), 'accepted by storedShapes and refused by the real parser').not.toBeNull()
  })

  it('an empty tabs file is claimed on its container, and an empty history file is not', () => {
    // The asymmetry above, asserted rather than described. Flipping either is
    // then a deliberate edit with a failing test attached.
    expect(isTabsShape({ tabs: [] })).toBe(true)
    expect(isHistoryShape([])).toBe(false)
    withFile('tabs.json', JSON.stringify({ tabs: [] }), path => {
      expect(loadTabs(path).tabs.length, 'accepted on its container, and genuinely empty').toBe(0)
    })
  })

  it('and the readers stay forgiving, which is why they are not the same function', () => {
    // The regression that wiring the strict test into the readers would have
    // caused: one bad row would take the good ones with it.
    const mixed = JSON.stringify([{ url: 'https://example.com' }, 'junk'])
    expect(isHistoryShape(JSON.parse(mixed)), 'attribution refuses a file it cannot vouch for whole').toBe(false)
    withFile('history.json', mixed, path => {
      expect(loadHistory(path).length, 'loading must still keep the good row').toBe(1)
    })
  })
})
