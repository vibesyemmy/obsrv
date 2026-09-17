import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Every channel the renderer's preload sends or invokes has a handler in main.
 *
 * `window.obsrv.moveTab` sent `IPC.moveTab` from the day tab dragging shipped
 * (5ca36ee) and nothing in main listened, so every drag did nothing; the e2e
 * that covered dragging called `tabs.move()` in main directly and passed
 * (Wren's release sweep, 2026-09-17). A send with no listener is silent by
 * construction — Electron drops it — so it has to be caught by reading.
 */
const ROOT = resolve(__dirname, '../..')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('preload channels', () => {
  it('every IPC channel the renderer preload sends or invokes is handled in main', () => {
    const preload = readFileSync(join(ROOT, 'src/preload/app.ts'), 'utf8')
    const sent = new Set([...preload.matchAll(/ipcRenderer\.(?:send|invoke|sendSync)\(\s*IPC\.(\w+)/g)].map(m => m[1]!))
    // Not vacuous: the preload still sends through this shape.
    expect(sent.size, 'no ipcRenderer.send/invoke(IPC.x) found in src/preload/app.ts').toBeGreaterThan(30)

    const handled = new Set<string>()
    for (const file of tsFiles(join(ROOT, 'src/main'))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\b(?:on|handle|once|ipcMain\.on|ipcMain\.handle|ipcMain\.once)\(\s*IPC\.(\w+)/g)) handled.add(m[1]!)
    }
    const unhandled = [...sent].filter(c => !handled.has(c)).sort()
    expect(unhandled, `sent by the preload and handled nowhere in src/main: ${unhandled.join(', ')}`).toEqual([])
  })
})
