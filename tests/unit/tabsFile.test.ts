import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTabs, saveTabs, type StoredTabs } from '../../src/shared/tabsFile'

// Every temp dir is tracked so the absent-file case cleans up too — it makes a
// directory it never writes into, and an untracked one would survive the run.
const dirs: string[] = []
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'obsrv-tabs-'))
  dirs.push(d)
  return d
}
const file = (): string => join(dir(), 'tabs.json')

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('loadTabs', () => {
  it('round-trips a saved list', () => {
    const f = file()
    saveTabs(f, {
      tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn' }],
      activeIndex: 0,
    })
    expect(loadTabs(f)).toEqual({
      tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn' }],
      activeIndex: 0,
    })
  })

  it('reads an absent file as empty', () => {
    expect(loadTabs(join(dir(), 'nope.json'))).toEqual({ tabs: [], activeIndex: 0 })
  })

  it('reads a malformed file as empty rather than throwing', () => {
    const f = file()
    writeFileSync(f, '{ not json')
    expect(loadTabs(f)).toEqual({ tabs: [], activeIndex: 0 })
  })

  it('drops an entry whose url is not a string', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 5 }, { url: 'https://x/' }], activeIndex: 0 }))
    expect(loadTabs(f).tabs).toHaveLength(1)
  })

  it('clamps an activeIndex past the end', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 'https://x/' }], activeIndex: 9 }))
    expect(loadTabs(f).activeIndex).toBe(0)
  })

  it('falls back to defaults for an unknown preset or profile', () => {
    const f = file()
    writeFileSync(
      f,
      JSON.stringify({ tabs: [{ url: 'https://x/', presetId: 'nope', profileId: 'nope' }], activeIndex: 0 }),
    )
    const t = loadTabs(f).tabs[0]!
    expect(t.presetId).toBe('1080p-24')
    expect(t.profileId).toBe('reference')
  })
})

describe('saveTabs', () => {
  // The write side is the strict one, exactly as `saveSettings` is: `loadTabs`
  // forgives whatever is on disk because it has no choice, but nothing inside
  // the app has any business handing the writer a tab with no url.
  // Both assert the message, not just the class: a string `tabs` is iterable,
  // so dropping the array guard still throws — from the per-entry guard, about
  // the wrong thing. Only the message tells the two apart.
  it('refuses a non-array tab list', () => {
    expect(() => saveTabs(file(), { tabs: 'x', activeIndex: 0 } as unknown as StoredTabs)).toThrow(
      'tabs must be an array',
    )
  })

  it('refuses a tab whose url is not a string', () => {
    expect(() =>
      saveTabs(file(), {
        tabs: [{ url: 7, presetId: '1080p-24', profileId: 'reference' }],
        activeIndex: 0,
      } as unknown as StoredTabs),
    ).toThrow('each tab needs a url string')
  })
})
