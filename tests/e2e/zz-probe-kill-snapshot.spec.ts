import { test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { cpus } from 'node:os'
import { launchApp } from './launch'

/**
 * THROWAWAY PROBE, never merged: the card's controls 1 to 3 for the kill
 * snapshot (board/chore-e2e-snapshot-at-the-kill.md). Each test launches its
 * own app, makes `app.close()` hang, and lets the harness's own `boundedClose`
 * print the snapshot after ten seconds. The reading is in the job log.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

test('control 1: main busy-waiting for 45 s reads busy', async () => {
  const app = await launchApp()
  console.log(`[probe] control 1: spinning main of pid ${app.process().pid}`)
  void app.evaluate(() => { const end = Date.now() + 45_000; while (Date.now() < end) { /* spin */ } }).catch(() => {})
  await sleep(1_000)
  await app.close()
})

test('control 2: main stopped with SIGSTOP reads T', async () => {
  const app = await launchApp()
  const pid = app.process().pid!
  console.log(`[probe] control 2: SIGSTOP to main pid ${pid}`)
  process.kill(pid, 'SIGSTOP')
  await sleep(500)
  await app.close()
})

test('control 3: idle app on a host under CPU burners reads app idle, host busy', async () => {
  const app = await launchApp()
  const burners: ChildProcess[] = []
  try {
    for (let i = 0; i < cpus().length; i++) burners.push(spawn(process.execPath, ['-e', 'while(1){}'], { stdio: 'ignore' }))
    console.log(`[probe] control 3: ${burners.length} burner pids ${burners.map(b => b.pid).join(',')}; main pid ${app.process().pid}`)
    await app.evaluate(({ app: a }) => { a.on('before-quit', e => e.preventDefault()) })
    await sleep(8_000)
    await app.close()
  } finally {
    for (const b of burners) b.kill('SIGKILL')
  }
})
