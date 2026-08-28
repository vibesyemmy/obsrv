import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HISTORY_MAX,
  HISTORY_SUGGESTIONS,
  MAX_URL_LENGTH,
  matchHistory,
  recordVisit,
  type HistoryEntry,
} from '../../src/shared/history'
import { loadHistory, saveHistory } from '../../src/shared/historyFile'

const dir = () => mkdtempSync(join(tmpdir(), 'obsrv-history-'))
const entry = (url: string, visits: number, lastVisit: number): HistoryEntry => ({ url, visits, lastVisit })

describe('recordVisit', () => {
  it('adds a URL that has not been seen', () => {
    expect(recordVisit([], 'https://example.test/a', 1000)).toEqual([
      { url: 'https://example.test/a', visits: 1, lastVisit: 1000 },
    ])
  })

  it('updates the existing entry rather than adding a second one', () => {
    const first = recordVisit([], 'https://example.test/a', 1000)
    const second = recordVisit(first, 'https://example.test/a', 2000)
    expect(second).toEqual([{ url: 'https://example.test/a', visits: 2, lastVisit: 2000 }])
  })

  it('leaves the list untouched — same reference — for a URL it will not store', () => {
    const list = [entry('https://example.test/a', 1, 1000)]
    // Main writes the file only when the reference changes, so this identity
    // is the thing that keeps `about:blank` on every launch off the disk.
    expect(recordVisit(list, 'about:blank', 2000)).toBe(list)
    expect(recordVisit(list, '', 2000)).toBe(list)
    expect(recordVisit(list, 'javascript:alert(1)', 2000)).toBe(list)
    expect(recordVisit(list, `https://example.test/${'x'.repeat(MAX_URL_LENGTH)}`, 2000)).toBe(list)
  })

  it('ranks by recency, with visits breaking a tie', () => {
    let list: HistoryEntry[] = []
    list = recordVisit(list, 'https://often.test/', 1000)
    list = recordVisit(list, 'https://often.test/', 2000)
    list = recordVisit(list, 'https://often.test/', 3000)
    list = recordVisit(list, 'https://recent.test/', 4000)
    // Three visits do not outrank one that happened later.
    expect(list.map(e => e.url)).toEqual(['https://recent.test/', 'https://often.test/'])

    // Same instant: the busier address wins. Named so that visit count and
    // alphabetical order disagree — otherwise the last-resort tie-break on
    // the URL would produce this answer with no visit comparison at all.
    const tied = [entry('https://a-quiet.test/', 1, 9000), entry('https://z-busy.test/', 7, 9000)]
    expect(recordVisit(tied, 'https://third.test/', 5000).map(e => e.url)).toEqual([
      'https://z-busy.test/',
      'https://a-quiet.test/',
      'https://third.test/',
    ])
  })

  it('caps at HISTORY_MAX, evicting the least recently visited', () => {
    // Oldest first, so entry 0 is the one that must go.
    let list: HistoryEntry[] = Array.from({ length: HISTORY_MAX }, (_, i) =>
      entry(`https://example.test/${i}`, 1, 1000 + i),
    )
    list = recordVisit(list, 'https://newcomer.test/', 999_999)
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list[0]!.url).toBe('https://newcomer.test/')
    expect(list.some(e => e.url === 'https://example.test/0')).toBe(false)
    expect(list.some(e => e.url === `https://example.test/${HISTORY_MAX - 1}`)).toBe(true)
  })

  it('re-visiting an entry at the cap evicts nothing', () => {
    let list: HistoryEntry[] = Array.from({ length: HISTORY_MAX }, (_, i) =>
      entry(`https://example.test/${i}`, 1, 1000 + i),
    )
    list = recordVisit(list, 'https://example.test/0', 999_999)
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list[0]).toEqual({ url: 'https://example.test/0', visits: 2, lastVisit: 999_999 })
  })
})

describe('matchHistory', () => {
  const list = [
    entry('https://staging.example.test/checkout', 2, 5000),
    entry('http://localhost:4173/', 9, 4000),
    entry('https://example.test/PRICING', 1, 3000),
  ]

  it('matches a case-insensitive substring anywhere in the URL', () => {
    expect(matchHistory(list, 'CHECKOUT').map(e => e.url)).toEqual(['https://staging.example.test/checkout'])
    expect(matchHistory(list, 'pricing').map(e => e.url)).toEqual(['https://example.test/PRICING'])
    expect(matchHistory(list, '4173').map(e => e.url)).toEqual(['http://localhost:4173/'])
  })

  it('returns matches in rank order, not file order', () => {
    const jumbled = [
      entry('https://example.test/old', 50, 1000),
      entry('https://example.test/new', 1, 9000),
    ]
    expect(matchHistory(jumbled, 'example').map(e => e.url)).toEqual([
      'https://example.test/new',
      'https://example.test/old',
    ])
  })

  it('offers the most recent addresses for an empty query', () => {
    expect(matchHistory(list, '').map(e => e.url)).toEqual(list.map(e => e.url))
    expect(matchHistory(list, '   ').map(e => e.url)).toEqual(list.map(e => e.url))
  })

  it('returns nothing when nothing matches', () => {
    expect(matchHistory(list, 'no-such-host')).toEqual([])
  })

  it('never returns more than HISTORY_SUGGESTIONS rows', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(`https://example.test/${i}`, 1, 1000 + i))
    expect(matchHistory(many, 'example')).toHaveLength(HISTORY_SUGGESTIONS)
    // And the six it picks are the six most recent.
    expect(matchHistory(many, 'example')[0]!.url).toBe('https://example.test/39')
  })
})

describe('loadHistory', () => {
  it('returns an empty list when the file is missing', () => {
    expect(loadHistory(join(dir(), 'nope.json'))).toEqual([])
  })

  it('returns an empty list when the file is corrupt', () => {
    const f = join(dir(), 'history.json')
    writeFileSync(f, '{not json')
    expect(loadHistory(f)).toEqual([])
  })

  it('returns an empty list when the file is not an array', () => {
    const f = join(dir(), 'history.json')
    writeFileSync(f, JSON.stringify({ url: 'https://example.test/' }))
    expect(loadHistory(f)).toEqual([])
  })

  it('drops unusable rows and falls back per field on the rest', () => {
    const f = join(dir(), 'history.json')
    writeFileSync(
      f,
      JSON.stringify([
        { url: 'https://keep.test/', visits: 4, lastVisit: 9000 },
        { url: 'https://fallback.test/', visits: 'lots', lastVisit: 'yesterday' },
        { url: 'about:blank', visits: 1, lastVisit: 8000 },
        { url: 42, visits: 1, lastVisit: 8000 },
        'not an object',
        { url: 'https://keep.test/', visits: 99, lastVisit: 1 },
      ]),
    )
    expect(loadHistory(f)).toEqual([
      { url: 'https://keep.test/', visits: 4, lastVisit: 9000 },
      { url: 'https://fallback.test/', visits: 1, lastVisit: 0 },
    ])
  })

  it('applies the cap to a file that grew past it', () => {
    const f = join(dir(), 'history.json')
    writeFileSync(
      f,
      JSON.stringify(
        Array.from({ length: HISTORY_MAX + 20 }, (_, i) => entry(`https://example.test/${i}`, 1, 1000 + i)),
      ),
    )
    const loaded = loadHistory(f)
    expect(loaded).toHaveLength(HISTORY_MAX)
    expect(loaded[0]!.url).toBe(`https://example.test/${HISTORY_MAX + 19}`)
  })
})

describe('saveHistory', () => {
  it('round-trips through the file, in rank order', () => {
    const f = join(dir(), 'history.json')
    let list: HistoryEntry[] = []
    list = recordVisit(list, 'http://localhost:4173/', 1000)
    list = recordVisit(list, 'https://example.test/a', 2000)
    list = recordVisit(list, 'http://localhost:4173/', 3000)
    saveHistory(f, list)
    expect(loadHistory(f)).toEqual([
      { url: 'http://localhost:4173/', visits: 2, lastVisit: 3000 },
      { url: 'https://example.test/a', visits: 1, lastVisit: 2000 },
    ])
  })

  it('writes an empty list, which is what Clear leaves behind', () => {
    const f = join(dir(), 'history.json')
    saveHistory(f, [entry('https://example.test/', 1, 1000)])
    saveHistory(f, [])
    expect(loadHistory(f)).toEqual([])
  })

  it('refuses to store anything invalid', () => {
    const f = join(dir(), 'history.json')
    expect(() => saveHistory(f, null as unknown as HistoryEntry[])).toThrow(RangeError)
    expect(() => saveHistory(f, [entry('about:blank', 1, 1000)])).toThrow(RangeError)
    expect(() => saveHistory(f, [entry('https://example.test/', 0, 1000)])).toThrow(RangeError)
    expect(() => saveHistory(f, [entry('https://example.test/', 1.5, 1000)])).toThrow(RangeError)
    expect(() => saveHistory(f, [entry('https://example.test/', 1, NaN)])).toThrow(RangeError)
    expect(() =>
      saveHistory(f, Array.from({ length: HISTORY_MAX + 1 }, (_, i) => entry(`https://example.test/${i}`, 1, i))),
    ).toThrow(RangeError)
  })
})
