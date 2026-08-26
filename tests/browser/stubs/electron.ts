/**
 * Stands in for `electron` so the sandboxed sync preload can be imported into
 * the browser test project, where a real `document` exists and `findScroller`
 * can be exercised against actual layout. The preload touches `ipcRenderer`
 * only — one `on` at module scope and a `send` per applied scroll — so a pair
 * of recorders is the whole surface. Aliased in vitest.config.ts for the
 * browser project alone; nothing in the app build resolves this file.
 */
export const sent: Array<{ channel: string; payload: unknown }> = []
export const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()

export const ipcRenderer = {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
    listeners.set(channel, listener)
  },
  send(channel: string, payload: unknown): void {
    sent.push({ channel, payload })
  },
}
