import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **Every unit test that spawns the built MCP server sets `OBSRV_TEST=1`.**
 *
 * It is a safety fence, not a formality. `ensureLive` uses a reachable app
 * without consulting it, but a discovery that comes back neither live nor
 * declined asks `cannotLaunchReason`, which **returns null on a Mac without
 * this variable** (`mcpLib.test.ts` pins that) — and the server then **launches
 * the installed Obsrv on the developer's real profile**, taking the desk and
 * writing to their data. On CI there is no installed app, so the whole hazard
 * is invisible there and lands only on the maintainer's laptop, on every
 * `npm test`.
 *
 * **Why a guard and not a note.** Idris made this accident by hand (room #4018:
 * a probe launched the real app and left a stray tab and a history entry in the
 * real profile), then found both of the new stub tests one push later carrying
 * the same hole — one of them with a comment arguing *against* the fence
 * (#4205). Three files now spawn that server and a fourth will be written by
 * someone who has not read this. Nothing sets `OBSRV_TEST` for unit runs
 * globally, so each file must, and that is the kind of promise a scan can keep
 * and a comment cannot.
 *
 * **What this cannot see:** an env built through a variable or a helper rather
 * than written at the call, and anything outside `tests/unit`. It reads the
 * text of each file that mentions the transport, so a spawn assembled
 * elsewhere would pass — named here rather than left for the next reader to
 * discover.
 */

const DIR = __dirname

/** Block and line comments blanked, newlines kept, so a commented-out spawn is not a finding. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, (_m, lead: string) => lead)
}

/** The text between the balanced braces of the object literal starting at `open`. */
function objectAt(code: string, open: number): string {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1)
  }
  return code.slice(open)
}

/** Each `new StdioClientTransport({...})` in a source, with whether its env fences the launch. */
export function stubSpawns(source: string): { fenced: boolean }[] {
  const code = stripComments(source)
  const out: { fenced: boolean }[] = []
  for (const m of code.matchAll(/new StdioClientTransport\(\s*\{/g)) {
    const literal = objectAt(code, code.indexOf('{', m.index))
    out.push({ fenced: /OBSRV_TEST\s*:\s*'1'/.test(literal) })
  }
  return out
}

describe('stubSpawns: the shape, before the real files', () => {
  it('reads a spawn whose env sets the fence as fenced, and one without it as not', () => {
    const fenced = "new StdioClientTransport({ command: x, args: [y], env: { ...process.env, OBSRV_TEST: '1', OBSRV_CONTROL_FILE: f } })"
    const bare = 'new StdioClientTransport({ command: x, args: [y], env: { ...process.env, OBSRV_CONTROL_FILE: f } })'
    expect(stubSpawns(fenced)).toEqual([{ fenced: true }])
    expect(stubSpawns(bare)).toEqual([{ fenced: false }])
  })

  it('reads the fence across lines, which is how it is actually written', () => {
    const wrapped = "new StdioClientTransport({\n  command: x,\n  env: {\n    ...process.env,\n    OBSRV_TEST: '1',\n  },\n})"
    expect(stubSpawns(wrapped)).toEqual([{ fenced: true }])
  })

  it('ignores a spawn that is only inside a comment', () => {
    expect(stubSpawns("// new StdioClientTransport({ env: { } })\nconst x = 1")).toEqual([])
    expect(stubSpawns('/* new StdioClientTransport({ env: {} }) */')).toEqual([])
  })

  it('finds every spawn in a file, not just the first', () => {
    const two = "new StdioClientTransport({ env: { OBSRV_TEST: '1' } })\nnew StdioClientTransport({ env: { } })"
    expect(stubSpawns(two)).toEqual([{ fenced: true }, { fenced: false }])
  })
})

describe('the real files under tests/unit', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.test.ts'))

  it('read the whole directory, so a clean answer below is not an empty one', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every file that spawns the MCP server fences the launch, and at least one does', () => {
    const spawns = files
      .filter(f => f !== 'mcpStubFence.test.ts')
      .flatMap(f => stubSpawns(readFileSync(join(DIR, f), 'utf8')).map((s, i) => ({ where: `${f}#${i + 1}`, ...s })))
    // Non-vacuity: if the pattern ever stops matching how we write these, this
    // check would pass by finding nothing at all — which is the failure mode it
    // is guarding other files against.
    expect(spawns.length, 'no MCP spawns found — the pattern no longer matches how these tests are written').toBeGreaterThan(2)
    const unfenced = spawns.filter(s => !s.fenced).map(s => s.where)
    expect(unfenced, `these spawn the MCP server without OBSRV_TEST=1 and can launch the installed app: ${unfenced.join(', ')}`).toEqual([])
  })
})
