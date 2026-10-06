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
/** Rows of the app's own tree printed: the parent and the host rows after it must never be crowded out of the line cap by a large tree. */
const MAX_TREE_ROWS = 16

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

/**
 * The executable's own name and its arguments, without the install path.
 *
 * Every process in the app's tree shares one long path
 * (`…/node_modules/electron/dist/Electron.app/Contents/Frameworks/…`), and the
 * only thing that tells a GPU helper from a renderer is a flag after it
 * (`--type=gpu-process`). Cut at a fixed width, the path used up the width on
 * the first CI probe and every helper read the same.
 */
export function shortCommand(command: string): string {
  const firstArg = command.indexOf(' -')
  const exe = firstArg === -1 ? command : command.slice(0, firstArg)
  const slash = exe.lastIndexOf('/')
  return slash === -1 ? command : exe.slice(slash + 1) + (firstArg === -1 ? '' : command.slice(firstArg))
}

/**
 * A process that is not the app's own, named by the basename of the first word of its command and nothing after it.
 *
 * The app's own tree keeps its arguments, because they are what tell a GPU
 * helper from a renderer. A host process is only being named as busy, and its
 * arguments are somebody else's: on a laptop the busiest five can be anything,
 * with whatever was passed on its command line (a URL with a token in it, a
 * script and its argument), and this text lands in a log that gets pasted and
 * uploaded. `ps` cannot say where an executable ends and its first argument
 * begins when the path has spaces, so this does not try: it takes the first
 * whitespace-delimited word, the executable or the start of its path, and
 * keeps only the last part of that. The cost is a name: a program whose path
 * has a space reads as its first word (`Google` for `Google Chrome Helper`).
 * Cutting at the first ` -` instead keeps every argument that does not start
 * with a dash, which is most of them (`curl https://x?token=...`).
 */
export function hostCommand(command: string): string {
  const first = command.trimStart().split(/\s+/, 1)[0] ?? ''
  const slash = first.lastIndexOf('/')
  return (slash === -1 ? first : first.slice(slash + 1)) || first
}

const rowLine = (r: ProcRow, command: string): string =>
  `  ${String(r.pid).padStart(7)} ${String(r.ppid).padStart(7)} ${r.state.padEnd(4)} ${r.cpu.toFixed(1).padStart(5)} ` +
  `${r.time.padStart(10)} ${r.etime.padStart(11)}  ${cut(command, COMMAND_CHARS)}`

/**
 * The process that launched the app, named by its first word and, when that is a script, the script's file name: `node workerProcessEntry.js`.
 *
 * In the harness this is the Playwright worker, and the file name is what says so. Nothing after it
 * is printed: a local run can be launched by any script with any arguments, and this text goes into a log
 * that gets pasted, so an argument (a flag, a token, a path to a secret) is not named here any more than
 * it is for a host process. A second word is taken only when it ends in a script extension and does not
 * start with a dash.
 */
export function parentCommand(command: string): string {
  const words = command.trim().split(/\s+/)
  const base = (w: string): string => w.slice(w.lastIndexOf('/') + 1) || w
  const first = base(words[0] ?? '')
  const second = words[1]
  return second !== undefined && !second.startsWith('-') && /\.(?:[cm]?js|ts)$/.test(second) ? `${first} ${base(second)}` : first
}

const rowText = (r: ProcRow): string => rowLine(r, shortCommand(r.command))
const hostRowText = (r: ProcRow): string => rowLine(r, hostCommand(r.command))
const parentRowText = (r: ProcRow): string => rowLine(r, parentCommand(r.command))

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
  // A table read of MAX_ROWS or more was cut: a process that is not in what was read may be in the rest.
  const readWasCut = rows.length >= MAX_ROWS
  const lines: string[] = [
    `[launch] kill snapshot for pid ${pid} (ps took ${psMs} ms; load ${load.map(n => n.toFixed(2)).join(' ')} on ${cores} cores):`,
  ]
  if (tree.length === 0) {
    lines.push(
      readWasCut
        ? `  pid ${pid} was not found in the first ${rows.length} rows of the process table, and the read was cut there`
        : `  pid ${pid} is not in the process table: it had already gone when the snapshot ran`,
    )
  } else {
    const { shown, hidden } = pickTreeRows(tree)
    lines.push(`  the app and its descendants (${tree.length}):`, COLUMNS, ...shown.map(rowText))
    if (hidden.length > 0) lines.push(`  … and ${hidden.length} more descendants (${describeHidden(hidden)})`)
  }
  const root = tree[0]
  const parent = root ? rows.find(r => r.pid === root.ppid) : undefined
  if (root) lines.push(...parentLines(root.ppid, parent, readWasCut))
  const top = topByCpu(rows, TOP_HOST_ROWS, new Set([...tree.map(r => r.pid), ...(parent ? [parent.pid] : [])]))
  if (top.length > 0) lines.push(`  busiest other processes on the host (${readWasCut ? `at least ${rows.length}, the read was cut there` : `${rows.length} in the table`}):`, COLUMNS, ...top.map(hostRowText))
  return capText(lines)
}

/**
 * Which of a large app tree to print: the root, then the descendants that say the most, not the first ones in table order.
 *
 * A snapshot that left out the one runnable or stopped child would read "nothing busy here" while the busy one sat in
 * the rows it did not print. So the slots go first to any descendant whose state is not plain sleeping or idle
 * (`R`, `T`, `U`, `Z`), then to the busiest by `%cpu`, and what is left out is summarised (`describeHidden`). The printed
 * rows keep the table's order.
 */
export function pickTreeRows(tree: readonly ProcRow[]): { shown: ProcRow[]; hidden: ProcRow[] } {
  if (tree.length <= MAX_TREE_ROWS) return { shown: [...tree], hidden: [] }
  const [root, ...rest] = tree as [ProcRow, ...ProcRow[]]
  const notAsleep = (r: ProcRow): number => (/^[SI]/.test(r.state) ? 0 : 1)
  const ranked = rest.map((r, i) => ({ r, i })).sort((a, b) => notAsleep(b.r) - notAsleep(a.r) || b.r.cpu - a.r.cpu || a.i - b.i)
  const chosen = new Set(ranked.slice(0, MAX_TREE_ROWS - 1).map(x => x.i))
  return { shown: [root, ...rest.filter((_r, i) => chosen.has(i))], hidden: rest.filter((_r, i) => !chosen.has(i)) }
}

/** What the rows that were left out of the tree were doing, so that leaving them out is itself a reading: `S×12, busiest 0.0%`. */
export function describeHidden(hidden: readonly ProcRow[]): string {
  const states = new Map<string, number>()
  for (const r of hidden) states.set(r.state.charAt(0) || '?', (states.get(r.state.charAt(0) || '?') ?? 0) + 1)
  const busiest = hidden.reduce((m, r) => Math.max(m, r.cpu), 0)
  return `${[...states].map(([s, n]) => `${s}×${n}`).join(' ')}; busiest ${busiest.toFixed(1)}%`
}

/**
 * The process that launched the app: in the harness, the Playwright worker that holds the link to it.
 *
 * The app's own tree can say whether the app was busy, stopped or idle, and
 * cannot say whether the other end of the link was. A worker that is busy,
 * stopped or gone reads differently from one that is idle, which is the half of
 * "stuck link or starved runner" the tree cannot show (Wren, `#4038`). It is in
 * the table already, so this costs no second command. It is named, not quoted:
 * see `parentCommand`.
 *
 * pid 1 is the launcher's own stand-in for "no parent": an app whose launcher
 * died is reparented to it, so a parent of 1 says the launcher had gone.
 */
function parentLines(ppid: number, parent: ProcRow | undefined, cut: boolean): string[] {
  if (!parent) {
    return [
      cut
        ? `  the app's parent, pid ${ppid}, was not found in the first rows of the process table, and the read was cut there`
        : `  the app's parent, pid ${ppid}, is not in the process table: the process that launched the app had already gone`,
    ]
  }
  const reparented = ppid === 1 ? ' (pid 1: the app was reparented, so the process that launched it had already gone)' : ''
  return [`  the app's parent, the process that launched it${reparented}:`, COLUMNS, parentRowText(parent)]
}

/**
 * The output caps. With the app's tree limited to `MAX_TREE_ROWS`, `formatSnapshot` stays under them by construction
 * (about 31 lines at most); this is the guard that keeps a later change to that from printing without bound, and it is
 * exported so it can be tested on its own.
 */
export function capText(lines: readonly string[]): string {
  const NOTE = '  … output capped'
  let kept = lines.slice(0, SNAPSHOT_MAX_LINES)
  let capped = kept.length < lines.length
  const fits = (ls: readonly string[]): boolean => Buffer.byteLength(ls.join('\n') + (capped ? `\n${NOTE}` : ''), 'utf8') <= SNAPSHOT_MAX_BYTES
  while (kept.length > 1 && !fits(kept)) {
    kept = kept.slice(0, -1)
    capped = true
  }
  // No line can exceed the byte cap by itself: a command is cut to COMMAND_CHARS characters, so a line is a few hundred bytes at most.
  return kept.join('\n') + (capped ? `\n${NOTE}` : '')
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
