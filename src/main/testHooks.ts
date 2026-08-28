import type { AppContext } from './context'
import type { NativePane } from './nativePane'
import type { SyncBus } from './syncBus'
import type { TargetSource } from './targetSource'

/**
 * What Playwright sees. Specs reach `__obsrv.native` / `.target` directly, so
 * those names stay on the handle as accessors onto the active session rather
 * than as fields — a spec must never capture a pane that a later tab switch
 * has replaced.
 */
export interface TestHandle extends AppContext {
  readonly native: NativePane
  readonly target: TargetSource
  readonly sync: SyncBus
}

declare global {
  // eslint-disable-next-line no-var
  var __obsrv: TestHandle | undefined
}

/** Publishes the app context on globalThis so Playwright can drive main. */
export function exposeForTests(ctx: AppContext): void {
  if (process.env.OBSRV_TEST !== '1') return
  globalThis.__obsrv = {
    ...ctx,
    get native() {
      return ctx.session.native
    },
    get target() {
      return ctx.session.target
    },
    get sync() {
      return ctx.session.sync
    },
  }
}
