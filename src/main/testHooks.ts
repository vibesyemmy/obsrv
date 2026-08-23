import type { AppContext } from './context'

declare global {
  // eslint-disable-next-line no-var
  var __obsrv: AppContext | undefined
}

/** Publishes the app context on globalThis so Playwright can drive main. */
export function exposeForTests(ctx: AppContext): void {
  if (process.env.OBSRV_TEST === '1') globalThis.__obsrv = ctx
}
