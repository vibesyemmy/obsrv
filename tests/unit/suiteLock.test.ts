import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * The suite lock, tested against fixture directories and planted pids — never
 * against the repo's own lock and never against a real process. Whether
 * another suite happens to be running on this machine is exactly the state the
 * lock exists to cope with, so a test that reads it is a test that fails on
 * whichever machine is in the state being handled. `electronPath.test.ts`
 * refuses the same way about the installed Electron.
 *
 * The distinction every assertion here is about: a lock held by a LIVE suite
 * and a lock left behind by one that DIED are identical as files. Only the
 * holder's liveness separates them, and a guard that cannot say which it found
 * gets its lock deleted by the first person it blocks.
 */
const {
  lockState,
  acquire,
  release,
  refusal,
  takeoverNotice,
  LOCK_YOUNG_MS,
} = createRequire(__filename)('../../scripts/suiteLock.js') as {
  lockState: (lockDir: string, isAlive: (pid: number) => boolean, now?: number) => LockState
  acquire: (lockDir: string, opts: { suite: string; pid: number; isAlive: (pid: number) => boolean; now?: number }) => AcquireResult
  takeoverNotice: (tookOver: { pid: number; suite: string; ageMs: number }) => string
  release: (lockDir: string, pid: number) => boolean
  refusal: (state: LockState) => string
  LOCK_YOUNG_MS: number
}

type LockState =
  | { state: 'free' }
  | { state: 'live'; pid: number; suite: string; ageMs: number }
  | { state: 'stale'; pid: number; suite: string; ageMs: number }
  | { state: 'starting'; ageMs: number }

type AcquireResult = { ok: true; tookOver: null | { pid: number; suite: string; ageMs: number } } | { ok: false; reason: LockState }

const fixture = (): string => mkdtempSync(join(tmpdir(), 'obsrv-suite-lock-'))
const alive = (): boolean => true
const dead = (): boolean => false

/** A lock on disk as a suite would have left it, without running one. */
const plant = (dir: string, holder: { pid: number; suite: string; startedAt?: number }): string => {
  const lockDir = join(dir, '.obsrv-suite.lock')
  mkdirSync(lockDir, { recursive: true })
  writeFileSync(
    join(lockDir, 'holder.json'),
    JSON.stringify({ pid: holder.pid, suite: holder.suite, startedAt: new Date(holder.startedAt ?? Date.now()).toISOString() }),
  )
  return lockDir
}

describe('suiteLock: which of the two it found', () => {
  it('reports free when no lock exists', () => {
    const dir = fixture()
    try {
      expect(lockState(join(dir, '.obsrv-suite.lock'), alive)).toEqual({ state: 'free' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a lock whose holder is running is LIVE, and names the suite and pid', () => {
    const dir = fixture()
    try {
      const lockDir = plant(dir, { pid: 4242, suite: 'e2e', startedAt: Date.now() - 90_000 })
      const state = lockState(lockDir, alive)
      expect(state.state).toBe('live')
      if (state.state !== 'live') return
      expect(state.pid).toBe(4242)
      expect(state.suite).toBe('e2e')
      expect(state.ageMs).toBeGreaterThanOrEqual(90_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a lock whose holder is gone is STALE — the same file, a different answer', () => {
    const dir = fixture()
    try {
      const lockDir = plant(dir, { pid: 4242, suite: 'e2e', startedAt: Date.now() - 90_000 })
      // Identical on disk to the case above. Only the holder differs.
      const state = lockState(lockDir, dead)
      expect(state.state).toBe('stale')
      if (state.state !== 'stale') return
      expect(state.pid).toBe(4242)
      expect(state.suite).toBe('e2e')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a lock with no holder file yet is STARTING, not stale, while it is young', () => {
    // Its owner is between mkdir and the write. Calling that stale lets a
    // second suite take a lock a first suite is in the middle of taking.
    const dir = fixture()
    try {
      const lockDir = join(dir, '.obsrv-suite.lock')
      mkdirSync(lockDir)
      expect(lockState(lockDir, dead).state).toBe('starting')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a holderless lock older than the grace is stale, whatever it once was', () => {
    const dir = fixture()
    try {
      const lockDir = join(dir, '.obsrv-suite.lock')
      mkdirSync(lockDir)
      const state = lockState(lockDir, dead, Date.now() + LOCK_YOUNG_MS + 1_000)
      expect(state.state).toBe('stale')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('suiteLock: acquiring', () => {
  it('takes a free lock and records who holds it', () => {
    const dir = fixture()
    try {
      const lockDir = join(dir, '.obsrv-suite.lock')
      const got = acquire(lockDir, { suite: 'unit', pid: 777, isAlive: dead })
      expect(got).toEqual({ ok: true, tookOver: null })
      const held = JSON.parse(readFileSync(join(lockDir, 'holder.json'), 'utf8')) as { pid: number; suite: string }
      expect(held).toMatchObject({ pid: 777, suite: 'unit' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a lock held by a live suite', () => {
    const dir = fixture()
    try {
      const lockDir = plant(dir, { pid: 4242, suite: 'e2e' })
      const got = acquire(lockDir, { suite: 'unit', pid: 777, isAlive: alive })
      expect(got.ok).toBe(false)
      if (got.ok) return
      expect(got.reason.state).toBe('live')
      // The live holder keeps it.
      const held = JSON.parse(readFileSync(join(lockDir, 'holder.json'), 'utf8')) as { pid: number }
      expect(held.pid).toBe(4242)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes over a stale lock rather than blocking on a dead owner, and says whose it was and how long dead', () => {
    // Blocking here is what gets the lock deleted by hand by the first person
    // it stops, after which nobody trusts it again.
    //
    // The age travels with the takeover because the caller announces it, and a
    // caller with no age to hand prints a number it made up. Seen for real:
    // the first run of this guard against a suite killed ten seconds earlier
    // announced "it died 0s ago", which is a sentence keying off nothing.
    const dir = fixture()
    try {
      const lockDir = plant(dir, { pid: 4242, suite: 'e2e', startedAt: Date.now() - 42_000 })
      const got = acquire(lockDir, { suite: 'unit', pid: 777, isAlive: dead })
      expect(got.ok).toBe(true)
      if (!got.ok) return
      expect(got.tookOver).toMatchObject({ pid: 4242, suite: 'e2e' })
      expect(got.tookOver?.ageMs).toBeGreaterThanOrEqual(42_000)
      const held = JSON.parse(readFileSync(join(lockDir, 'holder.json'), 'utf8')) as { pid: number; suite: string }
      expect(held).toMatchObject({ pid: 777, suite: 'unit' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('releases only its own lock', () => {
    const dir = fixture()
    try {
      const lockDir = plant(dir, { pid: 4242, suite: 'e2e' })
      expect(release(lockDir, 777)).toBe(false)
      expect(existsSync(lockDir)).toBe(true)
      expect(release(lockDir, 4242)).toBe(true)
      expect(existsSync(lockDir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('suiteLock: the refusal says which of the two it found', () => {
  it('a live holder is described as running, with its pid and age', () => {
    const text = refusal({ state: 'live', pid: 4242, suite: 'e2e', ageMs: 125_000 })
    expect(text).toMatch(/running/i)
    expect(text).toContain('4242')
    expect(text).toContain('e2e')
    expect(text).toMatch(/2m 5s|125/)
    // The word that would send someone to delete the lock must not appear.
    expect(text).not.toMatch(/stale/i)
  })

  it('a stale lock is named as stale, and says the holder is gone', () => {
    const text = refusal({ state: 'stale', pid: 4242, suite: 'e2e', ageMs: 125_000 })
    expect(text).toMatch(/stale/i)
    expect(text).toMatch(/no longer running|died|is gone/i)
    expect(text).toContain('4242')
  })

  it('the takeover notice states how long the holder had been dead, from the lock itself', () => {
    expect(takeoverNotice({ pid: 4242, suite: 'e2e', ageMs: 42_000 })).toMatch(/42s/)
    expect(takeoverNotice({ pid: 4242, suite: 'e2e', ageMs: 125_000 })).toMatch(/2m 5s/)
  })

  it('never describes a lock as merely "in use", which fits both', () => {
    for (const state of [
      { state: 'live' as const, pid: 1, suite: 'unit', ageMs: 1_000 },
      { state: 'stale' as const, pid: 1, suite: 'unit', ageMs: 1_000 },
    ]) {
      const text = refusal(state)
      expect(text).not.toMatch(/^.*lock (is )?in use\.?$/i)
    }
    // And the two must not read the same: a message that fits both facts is
    // the defect this guard exists to avoid.
    expect(refusal({ state: 'live', pid: 1, suite: 'unit', ageMs: 1_000 })).not.toBe(
      refusal({ state: 'stale', pid: 1, suite: 'unit', ageMs: 1_000 }),
    )
  })
})
