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
      tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn', orientation: 'portrait', textScale: 1 }],
      activeIndex: 0,
    })
    expect(loadTabs(f)).toEqual({
      tabs: [{ url: 'http://localhost:4173/', presetId: 'laptop-768', profileId: 'budget-tn', orientation: 'portrait', textScale: 1 }],
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

  // The cap is the loader's business because restoring is the one moment the
  // app builds tabs from something it did not write: a hand-edited file, or one
  // from a launch when the cap was higher, would otherwise stand up forty pairs
  // of Chromium renderers past a cap of twelve — the cap's whole point.
  it('truncates a list longer than the cap, keeping the tabs from the front', () => {
    const f = file()
    const many = Array.from({ length: 40 }, (_v, i) => ({ url: `https://x/${i}` }))
    writeFileSync(f, JSON.stringify({ tabs: many, activeIndex: 0 }))
    const loaded = loadTabs(f, 12)
    expect(loaded.tabs).toHaveLength(12)
    expect(loaded.tabs.at(-1)!.url).toBe('https://x/11')
  })

  it('re-bounds an activeIndex the truncation stranded', () => {
    const f = file()
    const many = Array.from({ length: 40 }, (_v, i) => ({ url: `https://x/${i}` }))
    writeFileSync(f, JSON.stringify({ tabs: many, activeIndex: 30 }))
    // The tab that was in front is not among the survivors, so the front goes
    // to the first — never to an index that now names a different page.
    expect(loadTabs(f, 12).activeIndex).toBe(0)
  })

  it('keeps an activeIndex the truncation spared', () => {
    const f = file()
    const many = Array.from({ length: 40 }, (_v, i) => ({ url: `https://x/${i}` }))
    writeFileSync(f, JSON.stringify({ tabs: many, activeIndex: 3 }))
    expect(loadTabs(f, 12).activeIndex).toBe(3)
  })

  it('leaves the list alone with no cap given', () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ tabs: [{ url: 'https://x/' }, { url: 'https://y/' }], activeIndex: 1 }))
    expect(loadTabs(f).tabs).toHaveLength(2)
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

describe('loadTabs orientation', () => {
  it('round-trips a rotated tab', () => {
    const f = file()
    saveTabs(f, {
      tabs: [{ url: 'http://localhost:4173/', presetId: 'iphone-61', profileId: 'reference', orientation: 'landscape', textScale: 1 }],
      activeIndex: 0,
    })
    expect(loadTabs(f).tabs[0]!.orientation).toBe('landscape')
  })

  it('falls back to portrait for a tab written before the field existed', () => {
    const f = file()
    writeFileSync(
      f,
      JSON.stringify({ tabs: [{ url: 'http://a/', presetId: 'iphone-61', profileId: 'reference' }], activeIndex: 0 }),
    )
    expect(loadTabs(f).tabs[0]!.orientation).toBe('portrait')
  })

  it('falls back to portrait for a malformed orientation rather than throwing', () => {
    const f = file()
    for (const bad of ['sideways', '', 0, null, {}, ['landscape']]) {
      writeFileSync(
        f,
        JSON.stringify({
          tabs: [{ url: 'http://a/', presetId: 'iphone-61', profileId: 'reference', orientation: bad }],
          activeIndex: 0,
        }),
      )
      expect(loadTabs(f).tabs[0]!.orientation).toBe('portrait')
    }
  })

  it('keeps the rest of a tab when only the orientation is junk', () => {
    const f = file()
    writeFileSync(
      f,
      JSON.stringify({
        tabs: [{ url: 'http://a/', presetId: 'iphone-61', profileId: 'budget-tn', orientation: 42 }],
        activeIndex: 0,
      }),
    )
    expect(loadTabs(f).tabs[0]).toEqual({
      url: 'http://a/',
      presetId: 'iphone-61',
      profileId: 'budget-tn',
      orientation: 'portrait',
      textScale: 1,
    })
  })
})

describe('loadTabs textScale', () => {
  const file = (): string => join(mkdtempSync(join(tmpdir(), 'obsrv-tabs-scale-')), 'tabs.json')
  it('round-trips a scale', () => {
    const f = file()
    saveTabs(f, {
      tabs: [{ url: 'http://localhost:4173/', presetId: 'iphone-61', profileId: 'reference', orientation: 'portrait', textScale: 1.5 }],
      activeIndex: 0,
    })
    expect(loadTabs(f).tabs[0]!.textScale).toBe(1.5)
  })
  it('a file from before the field, or one with junk in it, reads as ×1 and keeps the tab', () => {
    const f = file()
    for (const bad of [undefined, 'big', 0, 0.1, 10, null, {}, [1.5], Number.NaN]) {
      writeFileSync(
        f,
        JSON.stringify({
          tabs: [{ url: 'http://a/', presetId: 'iphone-61', profileId: 'budget-tn', orientation: 'landscape', textScale: bad }],
          activeIndex: 0,
        }),
      )
      expect(loadTabs(f).tabs[0]).toEqual({ url: 'http://a/', presetId: 'iphone-61', profileId: 'budget-tn', orientation: 'landscape', textScale: 1 })
    }
  })
})
