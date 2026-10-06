import { execFile, type ChildProcess } from 'node:child_process'
import { cpus, loadavg } from 'node:os'

/**
 * What the machine and the process were doing when the harness gave up on a
 * hung close (`board/chore-e2e-snapshot-at-the-kill.md`).
 *
 * `boundedClose` already prints the app's own log tail, and in most of the
 * hangs on record that tail says nothing about which stretch did not finish
 * (`starting`, `gpu`, no `quitting`). The three readings left standing — the
 * main process was busy, the harness's link to it was stuck, the runner was
 * stalled — cannot be told apart from inside the app. A process table and a
 * load average can rule some of them out, so one snapshot is printed before
 * the kill.
 *
 * **It sits in the failure path, so the one rule is that it cannot make
 * things worse.** A diagnostic that throws or hangs there turns one red into
 * two and buries the original. Every budget below was written on the card
 * before this file existed, and every one is enforced here rather than
 * hoped for:
 *
 *  - the whole snapshot is raced against `SNAPSHOT_TOTAL_MS`, and the kill
 *    proceeds when it loses;
 *  - the one subprocess has its own timeout and a buffer cap, and is
 *    released (killed, its pipes destroyed) when the race ends either way;
 *  - nothing else is spawned: load comes from `os.loadavg()`;
 *  - the text is capped at `SNAPSHOT_MAX_LINES` lines and `SNAPSHOT_MAX_BYTES`
 *    bytes;
 *  - nothing escapes: any failure becomes one line saying the snapshot is
 *    unavailable and why.
 *
 * What it can and cannot say is on the card. In short: it can rule a reading
 * out, and it cannot name the cause.
 */

/** Wall-clock cap on the whole snapshot. Past it the kill goes ahead regardless. */
export const SNAPSHOT_TOTAL_MS = 1_000
/** The `ps` call's own timeout. */
export const SNAPSHOT_PS_MS = 500
export const SNAPSHOT_MAX_LINES = 40
export const SNAPSHOT_MAX_BYTES = 4_096
/** The process table is about 255 KB on a quiet laptop; this leaves room for a busy runner. */
const PS_MAX_BUFFER = 4 * 1024 * 1024
/** Rows read from the table: bounds the synchronous parse, which no timer can interrupt. */
const MAX_ROWS = 5_000
const COMMAND_CHARS = 100
const TOP_HOST_ROWS = 5

/** pid, parent, state, %cpu, cumulative CPU time, elapsed, command. No header (`=` suffixes). */
export const PS_ARGS = ['-A', '-o', 'pid=,ppid=,state=,%cpu=,time=,etime=,command='] as const

export interface ProcRow {
  pid: number
  ppid: number
  state: string
  cpu: number
  time: string
  etime: string
  command: string
}

const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\S+)\s+(\S+)\s+(.*)$/

/** The process table as rows. A line that does not parse is dropped, not an error. */
export function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of out.split('\n', MAX_ROWS)) {
    const m = ROW.exec(line)
    if (!m) continue
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      state: m[3] ?? '',
      cpu: Number(m[4]),
      time: m[5] ?? '',
      etime: m[6] ?? '',
      command: m[7] ?? '',
    })
  }
  return rows
}

/** `root` and everything below it, root first. Walks by parent pid and cannot loop on a cycle. */
export function treeOf(rows: readonly ProcRow[], root: number): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>()
  for (const r of rows) {
    const siblings = byParent.get(r.ppid)
    if (siblings) siblings.push(r)
    else byParent.set(r.ppid, [r])
  }
  const start = rows.find(r => r.pid === root)
  if (!start) return []
  const seen = new Set<number>([start.pid])
  const out: ProcRow[] = [start]
  for (let i = 0; i < out.length; i++) {
    for (const child of byParent.get(out[i]!.pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      out.push(child)
    }
  }
  return out
}

/** The busiest processes on the host that are not in `exclude`, busiest first. */
export function topByCpu(rows: readonly ProcRow[], count: number, exclude: ReadonlySet<number>): ProcRow[] {
  return rows
    .filter(r => !exclude.has(r.pid))
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, count)
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const rowText = (r: ProcRow): string =>
  `  ${String(r.pid).padStart(7)} ${String(r.ppid).padStart(7)} ${r.state.padEnd(4)} ${r.cpu.toFixed(1).padStart(5)} ` +
  `${r.time.padStart(10)} ${r.etime.padStart(11)}  ${cut(r.command, COMMAND_CHARS)}`

const COLUMNS = '  pid     ppid    st    %cpu       time     elapsed  command'

export interface SnapshotInput {
  pid: number
  rows: readonly ProcRow[]
  load: readonly number[]
  cores: number
  /** How long the `ps` call took, in ms. */
  psMs: number
}

/**
 * The text printed at the kill. Capped by lines and by bytes; when the cap
 * bites it says so, because a silently shortened table reads as a complete one.
 */
export function formatSnapshot(input: SnapshotInput): string {
  const { pid, rows, load, cores, psMs } = input
  const tree = treeOf(rows, pid)
  const lines: string[] = [
    `[launch] kill snapshot for pid ${pid} (ps took ${psMs} ms; load ${load.map(n => n.toFixed(2)).join(' ')} on ${cores} cores):`,
  ]
  if (tree.length === 0) {
    lines.push(`  pid ${pid} is not in the process table: it had already gone when the snapshot ran`)
  } else {
    lines.push(`  the app and its descendants (${tree.length}):`, COLUMNS, ...tree.map(rowText))
  }
  const top = topByCpu(rows, TOP_HOST_ROWS, new Set(tree.map(r => r.pid)))
  if (top.length > 0) lines.push(`  busiest other processes on the host (${rows.length} in the table):`, COLUMNS, ...top.map(rowText))
  return capText(lines)
}

function capText(lines: readonly string[]): string {
  const NOTE = '  … output capped'
  let kept = lines.slice(0, SNAPSHOT_MAX_LINES)
  let capped = kept.length < lines.length
  const fits = (ls: readonly string[]): boolean => Buffer.byteLength(ls.join('\n') + (capped ? `\n${NOTE}` : ''), 'utf8') <= SNAPSHOT_MAX_BYTES
  while (kept.length > 1 && !fits(kept)) {
    kept = kept.slice(0, -1)
    capped = true
  }
  const text = kept.join('\n') + (capped ? `\n${NOTE}` : '')
  // One line can still be longer than the byte cap on its own; cut it by bytes.
  return Buffer.byteLength(text, 'utf8') <= SNAPSHOT_MAX_BYTES ? text : Buffer.from(text, 'utf8').subarray(0, SNAPSHOT_MAX_BYTES).toString('utf8')
}

/** One running `ps`: its output, and a way to release it that cannot throw. */
export interface PsRun {
  promise: Promise<string>
  abort: () => void
}

export interface SnapshotDeps {
  /** Starts a `ps`; replaceable so a test can make it fail, hang or flood. */
  runPs?: (budgetMs: number) => PsRun
  loadavg?: () => number[]
  cpuCount?: () => number
  totalMs?: number
  psMs?: number
}

function defaultRunPs(budgetMs: number): PsRun {
  let child: ChildProcess | undefined
  const promise = new Promise<string>((resolve, reject) => {
    child = execFile(
      'ps',
      [...PS_ARGS],
      { timeout: budgetMs, killSignal: 'SIGKILL', maxBuffer: PS_MAX_BUFFER, encoding: 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    )
    // The worker must not stay open for a `ps` that will not finish.
    child.unref()
  })
  return {
    promise,
    abort: () => {
      try {
        child?.kill('SIGKILL')
        child?.stdout?.destroy()
        child?.stderr?.destroy()
      } catch {
        // Nothing left to release.
      }
    },
  }
}

const reasonOf = (e: unknown): string => cut((e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' '), 200)

/**
 * The kill snapshot for `pid`. **Always resolves, never rejects, and settles
 * within about `totalMs`.** A failure of any kind comes back as a line that
 * begins `snapshot unavailable:`.
 */
export async function takeKillSnapshot(pid: number | undefined, deps: SnapshotDeps = {}): Promise<string> {
  const totalMs = deps.totalMs ?? SNAPSHOT_TOTAL_MS
  let abort: () => void = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (pid === undefined) return 'snapshot unavailable: the app has no pid'
    const started = Date.now()
    const run = (deps.runPs ?? defaultRunPs)(deps.psMs ?? SNAPSHOT_PS_MS)
    abort = run.abort
    const out = await Promise.race([
      run.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`ps did not answer within ${totalMs} ms`)), totalMs)
        // A pending timer must not hold the worker open either.
        timer.unref()
      }),
    ])
    const psMs = Date.now() - started
    const load = guarded(deps.loadavg ?? loadavg, [] as number[])
    const cores = guarded(deps.cpuCount ?? (() => cpus().length), 0)
    return formatSnapshot({ pid, rows: parsePs(out), load, cores, psMs })
  } catch (e) {
    return `snapshot unavailable: ${reasonOf(e)}`
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try {
      abort()
    } catch {
      // `abort` is ours and does not throw; a replaced one might.
    }
  }
}

/** A source we do not control (load, core count) may throw; the snapshot goes on without it. */
function guarded<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
