import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REMOVE_OPTIONS, killAndRemove } from './killAndRemove'

/**
 * `boardServeBrowser.test.ts` failed its teardown with `ENOTEMPTY` on `#594`'s first
 * suite attempt: it killed the server and removed the temp directory on the next line,
 * and a process still writing into the directory made the removal fail. The helper is
 * tested for its contract (what it asks `rm` to do, and in what order) and against a
 * real writer that outlives the process it was started by.
 */

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed: NodeJS.Signals[] = []
  constructor(private readonly exitsAfterMs: number | null) {
    super()
  }
  kill(signal: NodeJS.Signals): boolean {
    this.killed.push(signal)
    if (this.exitsAfterMs !== null) setTimeout(() => ((this.signalCode = signal), this.emit('exit', null, signal)), this.exitsAfterMs)
    return true
  }
}
const asChild = (f: FakeChild): ChildProcess => f as unknown as ChildProcess

describe('killAndRemove, the contract', () => {
  it('removes every directory with retries, which is what covers a grandchild that is still writing', async () => {
    const calls: Array<[string, unknown]> = []
    await killAndRemove([], ['/a', '/b'], { rm: (p, o) => void calls.push([p, o]) })
    expect(calls).toEqual([
      ['/a', REMOVE_OPTIONS],
      ['/b', REMOVE_OPTIONS],
    ])
    expect(REMOVE_OPTIONS).toMatchObject({ recursive: true, force: true })
    expect(REMOVE_OPTIONS.maxRetries).toBeGreaterThanOrEqual(5)
    expect(REMOVE_OPTIONS.retryDelay).toBeGreaterThanOrEqual(100)
  })

  it('kills with SIGKILL and removes only after the child has reported its exit', async () => {
    const child = new FakeChild(60)
    const order: string[] = []
    child.on('exit', () => order.push('exit'))
    await killAndRemove([asChild(child)], ['/a'], { rm: () => void order.push('rm') })
    expect(child.killed).toEqual(['SIGKILL'])
    expect(order).toEqual(['exit', 'rm'])
  })

  it('does not wait forever for a child that never reports an exit', async () => {
    const child = new FakeChild(null)
    const started = Date.now()
    let removed = false
    await killAndRemove([asChild(child)], ['/a'], { rm: () => void (removed = true), exitWaitMs: 80 })
    expect(removed).toBe(true)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('does not kill or wait for a child that has already exited', async () => {
    const child = new FakeChild(null)
    child.exitCode = 0
    let removed = false
    await killAndRemove([asChild(child)], ['/a'], { rm: () => void (removed = true), exitWaitMs: 5_000 })
    expect(child.killed).toEqual([])
    expect(removed).toBe(true)
  })
})

describe('killAndRemove against a real writer that outlives the process it was started by', () => {
  // The parent starts a detached writer and waits. Killing the parent does not stop the writer, which keeps creating
  // files in the directory for 700 ms: the shape of board-serve's `git fetch` child, which is the server's child and
  // not the test's.
  const WRITER = `
    const { writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    const end = Date.now() + 700
    let i = 0
    while (Date.now() < end) writeFileSync(join(process.argv[1], 'f' + (i++) + '.txt'), 'x')
  `
  const PARENT = `
    const { spawn } = require('node:child_process')
    spawn(process.execPath, ['-e', ${JSON.stringify(WRITER)}, process.argv[1]], { detached: true, stdio: 'ignore' }).unref()
    setInterval(() => {}, 1000)
  `

  it('removes the directory although something is still writing into it after the parent is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kill-and-remove-'))
    const parent = spawn(process.execPath, ['-e', PARENT, dir], { stdio: 'ignore' })
    // Until the writer has made its first file it is not a writer, and the old teardown passes this test vacuously
    // (measured by Wren on the first version, which slept a fixed 150 ms: on a slower machine the writer was not up
    // yet at the kill). So wait for the file, and fail loudly if it never appears.
    await vi.waitFor(
      () => {
        if (readdirSync(dir).length === 0) throw new Error('the writer has not made its first file')
      },
      { timeout: 8_000, interval: 10 },
    )
    await killAndRemove([parent], [dir])
    expect(existsSync(dir)).toBe(false)
  }, 20_000)
})
