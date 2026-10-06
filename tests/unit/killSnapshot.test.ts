import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { boundedClose, snapshotThenKill } from '../e2e/launch'
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_LINES,
  formatSnapshot,
  hostCommand,
  parsePs,
  shortCommand,
  takeKillSnapshot,
  topByCpu,
  treeOf,
  type PsRun,
} from '../e2e/helpers/killSnapshot'

/**
 * The kill snapshot sits in the failure path of `boundedClose`: a diagnostic
 * that throws or hangs there turns one red into two and buries the first.
 * So most of these are about what happens when `ps` fails, hangs or floods,
 * and not about how a healthy table looks. Each one names the behaviour it
 * guards; `board/chore-e2e-snapshot-at-the-kill.md` has the budgets.
 */

// pid ppid state %cpu time elapsed command, as `ps -A -o pid=,ppid=,state=,%cpu=,time=,etime=,command=` prints them.
const TABLE = [
  '    1     0 Ss     0.1  13:05.94 17:52:54 /sbin/launchd',
  '  500     1 Ss     0.0   0:00.10    05:00 /usr/sbin/cron',
  ' 4001     1 S      1.2   0:09.00    01:30 /Applications/Electron.app/Contents/MacOS/Electron -r loader.js --inspect=0 /work/out/main/index.js',
  ' 4002  4001 S      0.4   0:01.00    01:29 Electron Helper (GPU) --type=gpu-process',
  ' 4003  4001 R     98.5   0:41.20    01:29 Electron Helper (Renderer) --type=renderer',
  ' 4004  4003 S      0.0   0:00.01    01:28 Electron Helper (Utility) --type=utility',
  ' 9000     1 R     55.5   2:00.00 1-02:03:04 /usr/bin/some-other-burner --flag',
  '',
  'this line is not a process row',
].join('\n')

const hang = (): PsRun => ({ promise: new Promise<string>(() => {}), abort: () => {} })

describe('parsePs', () => {
  it('reads each row into its fields and keeps spaces inside the command', () => {
    const rows = parsePs(TABLE)
    expect(rows.map(r => r.pid)).toEqual([1, 500, 4001, 4002, 4003, 4004, 9000])
    const renderer = rows.find(r => r.pid === 4003)
    expect(renderer).toMatchObject({ ppid: 4001, state: 'R', cpu: 98.5, time: '0:41.20', etime: '01:29' })
    expect(renderer?.command).toBe('Electron Helper (Renderer) --type=renderer')
  })

  it('reads an elapsed time that carries a day count, and drops lines that are not rows', () => {
    const row = parsePs(TABLE).find(r => r.pid === 9000)
    expect(row?.etime).toBe('1-02:03:04')
    expect(parsePs('garbage\n\n   \nnot a number 1 2 3')).toEqual([])
  })

  it('stops reading after a bounded number of rows, so a flood cannot cost unbounded synchronous time', () => {
    const flood = Array.from({ length: 20_000 }, (_, i) => `${i + 1} 1 S 0.0 0:00.00 00:01 /bin/x${i}`).join('\n')
    expect(parsePs(flood).length).toBeLessThanOrEqual(5_000)
  })
})

describe('shortCommand', () => {
  const root = '/Users/runner/work/obsrv/obsrv/node_modules/electron/dist/Electron.app/Contents'

  it('keeps the helper type, which is what tells the processes in the tree apart', () => {
    expect(shortCommand(`${root}/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process --x=1`)).toBe(
      'Electron Helper (GPU) --type=gpu-process --x=1',
    )
    expect(shortCommand(`${root}/MacOS/Electron -r /w/loader.js --inspect=0 /w/out/main/index.js`)).toBe('Electron -r /w/loader.js --inspect=0 /w/out/main/index.js')
  })

  it('shortens a bare path to its last part, and leaves a command with no path alone', () => {
    expect(shortCommand('/sbin/launchd')).toBe('launchd')
    expect(shortCommand('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe('Google Chrome')
    expect(shortCommand('node -e while(1){}')).toBe('node -e while(1){}')
  })
})

describe('hostCommand', () => {
  it('names a process that is not the app by its executable and nothing else', () => {
    expect(hostCommand('/usr/bin/some-other-burner --token=SECRET --flag')).toBe('some-other-burner')
    expect(hostCommand('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper --type=renderer')).toBe('Google Chrome Helper')
    expect(hostCommand('node server.js --password hunter2')).toBe('node')
    expect(hostCommand('/sbin/launchd')).toBe('launchd')
  })
})

describe('treeOf', () => {
  it('returns the root and every descendant, root first', () => {
    expect(treeOf(parsePs(TABLE), 4001).map(r => r.pid)).toEqual([4001, 4002, 4003, 4004])
  })

  it('is empty when the root is not in the table: the process had already gone', () => {
    expect(treeOf(parsePs(TABLE), 31337)).toEqual([])
  })

  it('terminates on a table whose parent pids form a cycle', () => {
    const cyclic = parsePs(['10 11 S 0.0 0:00.00 00:01 a', '11 12 S 0.0 0:00.00 00:01 b', '12 10 S 0.0 0:00.00 00:01 c'].join('\n'))
    expect(treeOf(cyclic, 10).map(r => r.pid).sort()).toEqual([10, 11, 12])
  })
})

describe('topByCpu', () => {
  it('lists the busiest processes outside the excluded set, busiest first', () => {
    const rows = parsePs(TABLE)
    const top = topByCpu(rows, 2, new Set([4003]))
    expect(top.map(r => r.pid)).toEqual([9000, 4001])
  })
})

describe('formatSnapshot', () => {
  const input = (pid: number) => ({ pid, rows: parsePs(TABLE), load: [3.5, 2.25, 1], cores: 3, psMs: 31 })

  it('prints the app tree with its state and %cpu, and the busiest other processes', () => {
    const text = formatSnapshot(input(4001))
    expect(text).toContain('kill snapshot for pid 4001 (ps took 31 ms; load 3.50 2.25 1.00 on 3 cores)')
    expect(text).toMatch(/4003\s+4001\s+R\s+98\.5\s+0:41\.20/)
    expect(text).toContain('busiest other processes on the host')
    expect(text).toContain('some-other-burner')
  })

  it("does not print the arguments of a process that is not the app's, and does print the app's own", () => {
    const table = [
      '4001 1 S 0.1 0:01.00 01:00 /Applications/Electron.app/Contents/MacOS/Electron --inspect=0',
      '4002 4001 S 0.1 0:01.00 01:00 /x/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process',
      '9000 1 R 90.0 0:01.00 01:00 /usr/bin/other --token=SECRET',
    ].join('\n')
    const text = formatSnapshot({ pid: 4001, rows: parsePs(table), load: [1], cores: 2, psMs: 5 })
    expect(text).toContain('--type=gpu-process')
    expect(text).toContain('other')
    expect(text).not.toContain('SECRET')
  })

  it('says when it read only part of an enormous table', () => {
    const rows = Array.from({ length: 6_000 }, (_, i) => `${i + 1} 1 S 0.0 0:00.00 00:01 /bin/x${i}`).join('\n')
    // A pid that is not in the table, so the host section is printed (every row here is a descendant of pid 1).
    expect(formatSnapshot({ pid: 4_000_000, rows: parsePs(rows), load: [], cores: 1, psMs: 1 })).toContain('the read was cut there')
  })

  it('says so when the process is not in the table, instead of printing an empty tree', () => {
    expect(formatSnapshot(input(31337))).toContain('pid 31337 is not in the process table')
  })

  it('cuts a long command to a bounded width', () => {
    const long = `4001 1 S 0.0 0:00.00 00:01 /x ${'y'.repeat(5_000)}`
    const text = formatSnapshot({ pid: 4001, rows: parsePs(long), load: [], cores: 1, psMs: 1 })
    expect(text.split('\n').every(l => l.length < 220)).toBe(true)
  })

  it('caps the number of lines on its own, when short rows would not reach the byte cap', () => {
    const short = Array.from({ length: 400 }, (_, i) => `${5000 + i} 4001 S ${(i % 90).toFixed(1)} 0:00.01 00:01 x`).join('\n')
    const text = formatSnapshot({ pid: 4001, rows: parsePs(`4001 1 S 0.0 0:00.01 00:01 /app\n${short}`), load: [1], cores: 2, psMs: 5 })
    // The line cap and the cap's own note: 41 lines at most, and under the byte cap, so the byte cap did not cut it and only the line cap can have.
    expect(text.split('\n').length).toBeLessThanOrEqual(SNAPSHOT_MAX_LINES + 1)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(SNAPSHOT_MAX_BYTES)
    expect(text).toContain('output capped')
  })

  it('caps lines and bytes when the table is large, and says it did', () => {
    const many = Array.from({ length: 400 }, (_, i) => `${5000 + i} 4001 S ${(i % 90).toFixed(1)} 0:00.01 00:01 /bin/child-${'z'.repeat(80)}${i}`).join('\n')
    const text = formatSnapshot({ pid: 4001, rows: parsePs(`4001 1 S 0.0 0:00.01 00:01 /app\n${many}`), load: [1], cores: 2, psMs: 5 })
    expect(text.split('\n').length).toBeLessThanOrEqual(SNAPSHOT_MAX_LINES + 1)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
    expect(text).toContain('output capped')
  })
})

describe('takeKillSnapshot never throws and never outlasts its budget', () => {
  const fake = (out: string) => (): PsRun => ({ promise: Promise.resolve(out), abort: () => {} })
  const deps = { loadavg: () => [1, 1, 1], cpuCount: () => 4 }

  it('prints the snapshot for a healthy table', async () => {
    const text = await takeKillSnapshot(4001, { ...deps, runPs: fake(TABLE) })
    expect(text).toContain('kill snapshot for pid 4001')
    expect(text).not.toContain('snapshot unavailable')
  })

  it('turns a failing ps into one line that says so, and resolves', async () => {
    const text = await takeKillSnapshot(4001, { ...deps, runPs: () => ({ promise: Promise.reject(new Error('spawn ps ENOENT')), abort: () => {} }) })
    expect(text).toBe('snapshot unavailable: spawn ps ENOENT')
  })

  it('turns a ps that throws on the way in into the same one line', async () => {
    const text = await takeKillSnapshot(4001, {
      ...deps,
      runPs: () => {
        throw new Error('fork failed')
      },
    })
    expect(text).toBe('snapshot unavailable: fork failed')
  })

  it('gives up on a ps that never answers, within the budget, and releases it', async () => {
    let aborted = 0
    const started = Date.now()
    const text = await takeKillSnapshot(4001, {
      ...deps,
      totalMs: 60,
      runPs: () => ({ ...hang(), abort: () => void aborted++ }),
    })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(text).toContain('snapshot unavailable: ps did not answer within 60 ms')
    expect(aborted).toBe(1)
  })

  it('releases the ps after a normal answer too', async () => {
    let aborted = 0
    await takeKillSnapshot(4001, { ...deps, runPs: () => ({ promise: Promise.resolve(TABLE), abort: () => void aborted++ }) })
    expect(aborted).toBe(1)
  })

  it('survives an abort that throws', async () => {
    const text = await takeKillSnapshot(4001, {
      ...deps,
      runPs: () => ({
        promise: Promise.resolve(TABLE),
        abort: () => {
          throw new Error('already gone')
        },
      }),
    })
    expect(text).toContain('kill snapshot for pid 4001')
  })

  it('still prints the table when the load average or the core count cannot be read', async () => {
    const boom = (): never => {
      throw new Error('no load')
    }
    const text = await takeKillSnapshot(4001, { runPs: fake(TABLE), loadavg: boom, cpuCount: boom })
    expect(text).toContain('kill snapshot for pid 4001')
  })

  it('bounds what a flooding ps can put in the output', async () => {
    const flood = Array.from({ length: 200_000 }, (_, i) => `${i + 1} 1 S ${(i % 99).toFixed(1)} 0:00.00 00:01 /bin/flood-${i}`).join('\n')
    const text = await takeKillSnapshot(7, { ...deps, runPs: fake(flood) })
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
  })

  it('says so when the app has no pid', async () => {
    expect(await takeKillSnapshot(undefined, { ...deps, runPs: fake(TABLE) })).toBe('snapshot unavailable: the app has no pid')
  })
})

describe('against the real ps', () => {
  it("finds this test process in the real process table, with a state and a cumulative CPU time, within the budget", async () => {
    const started = Date.now()
    const text = await takeKillSnapshot(process.pid)
    expect(text).not.toContain('snapshot unavailable')
    expect(text).toMatch(new RegExp(`\\b${process.pid}\\s+\\d+\\s+\\S+\\s+\\d+\\.\\d\\s+\\S+\\s+\\S+\\s+`))
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('snapshotThenKill: the kill happens whatever the snapshot does', () => {
  const proc = () => {
    const calls: string[] = []
    return { calls, pid: 4001, kill: (signal?: NodeJS.Signals | number): boolean => (calls.push(`kill ${String(signal)}`), true) }
  }

  it('writes the snapshot, then kills, in that order', async () => {
    const p = proc()
    await snapshotThenKill(p, async () => 'SNAP', text => void p.calls.push(`write ${JSON.stringify(text)}`))
    expect(p.calls).toEqual(['write "SNAP\\n"', 'kill SIGKILL'])
  })

  it('kills when the snapshot rejects', async () => {
    const p = proc()
    await snapshotThenKill(p, () => Promise.reject(new Error('boom')), () => {})
    expect(p.calls).toEqual(['kill SIGKILL'])
  })

  it('kills when the snapshot throws before returning a promise', async () => {
    const p = proc()
    await snapshotThenKill(
      p,
      () => {
        throw new Error('boom')
      },
      () => {},
    )
    expect(p.calls).toEqual(['kill SIGKILL'])
  })

  it('kills when writing the snapshot throws', async () => {
    const p = proc()
    await snapshotThenKill(
      p,
      async () => 'SNAP',
      () => {
        throw new Error('stderr closed')
      },
    )
    expect(p.calls).toEqual(['kill SIGKILL'])
  })

  it('kills when the snapshot never settles, after the bound', async () => {
    const p = proc()
    const written: string[] = []
    const started = Date.now()
    await snapshotThenKill(p, () => new Promise<string>(() => {}), text => void written.push(text), 60)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(p.calls).toEqual(['kill SIGKILL'])
    expect(written.join('')).toContain('snapshot unavailable: no answer within 60 ms')
  })

  it('does not throw when the kill itself throws', async () => {
    const throwing = {
      pid: 4001,
      kill: (): boolean => {
        throw new Error('ESRCH')
      },
    }
    await expect(snapshotThenKill(throwing, async () => 'SNAP', () => {})).resolves.toBeUndefined()
  })
})

describe('boundedClose ends a hung close in a kill', () => {
  // A fake app: `process()` is the child the harness would kill, `close()` is whatever the test makes of it.
  const fakeApp = (close: () => Promise<void>) => {
    const calls: string[] = []
    const proc = { pid: 4001, kill: (signal?: NodeJS.Signals | number): boolean => (calls.push(`kill ${String(signal)}`), true) }
    return { calls, app: { close, process: () => proc as unknown as ChildProcess } }
  }
  const settle = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

  it('writes the report and then kills the app when close() outlasts the grace', async () => {
    const { calls, app } = fakeApp(() => new Promise<void>(() => {}))
    const written: string[] = []
    void boundedClose(app, {
      graceMs: 30,
      write: text => void written.push(text),
      killAfterSnapshot: proc => snapshotThenKill(proc, async () => 'SNAP', text => void written.push(text)),
    })
    await settle(150)
    expect(calls).toEqual(['kill SIGKILL'])
    expect(written[0]).toMatch(/^\[launch\] app\.close\(\) has taken \d+ ms; killing pid 4001\. App log tail:/)
    expect(written.join('')).toContain('SNAP')
  })

  it('kills even when the snapshot never settles', async () => {
    const { calls, app } = fakeApp(() => new Promise<void>(() => {}))
    void boundedClose(app, {
      graceMs: 30,
      write: () => {},
      killAfterSnapshot: proc => snapshotThenKill(proc, () => new Promise<string>(() => {}), () => {}, 40),
    })
    await settle(250)
    expect(calls).toEqual(['kill SIGKILL'])
  })

  it('with its defaults takes the real snapshot of the real process table, and then kills', async () => {
    // Only the grace is shortened and the report line captured. The snapshot is the real one (a pid that is not in the table), and so is the kill's path.
    const { calls, app } = fakeApp(() => new Promise<void>(() => {}))
    void boundedClose(app, { graceMs: 30, write: () => {} })
    await settle(900)
    expect(calls).toEqual(['kill SIGKILL'])
  })

  it('does not kill an app whose close finishes inside the grace, and leaves no timer behind', async () => {
    const { calls, app } = fakeApp(() => Promise.resolve())
    await boundedClose(app, { graceMs: 30, write: () => {}, killAfterSnapshot: proc => snapshotThenKill(proc, async () => 'SNAP', () => {}) })
    await settle(120)
    expect(calls).toEqual([])
  })

  it('passes a failing close on to the caller, and still does not kill afterwards', async () => {
    const { calls, app } = fakeApp(() => Promise.reject(new Error('Target page, context or browser has been closed')))
    await expect(boundedClose(app, { graceMs: 30, write: () => {} })).rejects.toThrow('has been closed')
    await settle(120)
    expect(calls).toEqual([])
  })
})
