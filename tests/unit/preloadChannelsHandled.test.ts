import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Every channel a preload sends or invokes has a handler in main.
 *
 * `window.obsrv.moveTab` sent `IPC.moveTab` from the day tab dragging shipped
 * (5ca36ee) and nothing in main listened, so every drag did nothing; the e2e
 * that covered dragging called `tabs.move()` in main directly and passed
 * (Wren's release sweep, 2026-09-17). A send with no listener is silent by
 * construction — Electron drops it — so it has to be caught by reading.
 *
 * Read in the three shapes the preloads actually send through, because a
 * guard that sees one shape passes quietly on the others
 * (chore-channel-guard-reach):
 * - `ipcRenderer.send(IPC.x, …)` in `src/preload/app.ts`;
 * - the target's `src/preload/sync.ts`, which sends through local constants
 *   typed `const NAME = '…' satisfies typeof IPC.x`;
 * - `frameChannel(IPC.frame, IPC.subscribe)` in `app.ts`, whose second
 *   argument is sent on the first subscriber. Main handles those through
 *   `attachFrameBus`'s `channels.subscribe`, so a `subscribe: IPC.x` in main
 *   counts as a handler, provided the bus still registers one.
 */
const ROOT = resolve(__dirname, '../..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

const matches = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map(m => m[1]!)

describe('preload channels', () => {
  it('every IPC channel a preload sends or invokes is handled in main', () => {
    const app = read('src/preload/app.ts')
    const direct = matches(app, /ipcRenderer\.(?:send|invoke|sendSync)\(\s*IPC\.(\w+)/g)
    // Not vacuous: the preload still sends through this shape.
    expect(direct.length, 'no ipcRenderer.send/invoke(IPC.x) found in src/preload/app.ts').toBeGreaterThan(30)

    const subscribes = matches(app, /frameChannel\(\s*IPC\.\w+\s*,\s*IPC\.(\w+)\s*\)/g)
    expect(subscribes.length, 'no frameChannel(IPC.x, IPC.y) found in src/preload/app.ts').toBeGreaterThanOrEqual(2)

    const sync = read('src/preload/sync.ts')
    const named = new Map([...sync.matchAll(/const (\w+) = '[^']*' satisfies typeof IPC\.(\w+)/g)].map(m => [m[1]!, m[2]!]))
    const viaConstant = matches(sync, /ipcRenderer\.(?:send|invoke|sendSync)\(\s*(\w+)/g)
    // A send through a name this guard cannot resolve would be a send it cannot check.
    const unresolved = viaConstant.filter(n => !named.has(n))
    expect(unresolved, `sync.ts sends through names that are not \`satisfies typeof IPC.x\` constants: ${unresolved.join(', ')}`).toEqual([])
    expect(viaConstant.length, 'no ipcRenderer.send(CONSTANT) found in src/preload/sync.ts').toBeGreaterThanOrEqual(4)
    const fromSync = viaConstant.map(n => named.get(n)!)

    const handled = new Set<string>()
    const subscribeHandlers = new Set<string>()
    for (const file of tsFiles(join(ROOT, 'src/main'))) {
      const text = readFileSync(file, 'utf8')
      for (const c of matches(text, /\b(?:on|handle|once|ipcMain\.on|ipcMain\.handle|ipcMain\.once)\(\s*IPC\.(\w+)/g)) handled.add(c)
      for (const c of matches(text, /\bsubscribe:\s*IPC\.(\w+)/g)) subscribeHandlers.add(c)
    }
    // The subscribe channels count as handled only while the frame bus still
    // listens on the one it is given.
    expect(read('src/main/frameBus.ts'), 'attachFrameBus no longer registers ipcMain.on(channels.subscribe)').toMatch(/ipcMain\.on\(\s*channels\.subscribe\b/)
    for (const c of subscribeHandlers) handled.add(c)

    const sent = [...new Set([...direct, ...subscribes, ...fromSync])]
    const unhandled = sent.filter(c => !handled.has(c)).sort()
    expect(unhandled, `sent by a preload and handled nowhere in src/main: ${unhandled.join(', ')}`).toEqual([])
  })
})
