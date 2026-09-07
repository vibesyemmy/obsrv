import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launching the desktop app from the MCP server (live-first spec §2a). The
 * resolution prefers the user's own install — the Dock icon, the update
 * check — and falls back to the Electron this package ships with, running
 * the GUI entry the DMG runs. Windows has no build, so it is refused here
 * rather than failing somewhere less legible.
 *
 * The bundle's executable is spawned directly rather than through `open -a`:
 * whether `open` forwards the environment is version-dependent, and the
 * whole point of the launch is that `OBSRV_AGENT_CONTROL=1` reaches the app.
 */

export type LaunchTarget = { kind: 'bundle'; executable: string } | { kind: 'electron'; electron: string; entry: string }

const BUNDLE_EXECUTABLE = join('Obsrv.app', 'Contents', 'MacOS', 'Obsrv')

export function resolveLaunchTarget(
  platform: NodeJS.Platform,
  home: string,
  packageRoot: string,
  exists: (p: string) => boolean,
  resolveElectron: () => { path?: string; error?: string },
): LaunchTarget | { error: string } {
  if (platform === 'win32') return { error: 'the Obsrv app has no Windows build to launch' }
  const tried: string[] = []
  if (platform === 'darwin') {
    for (const dir of ['/Applications', join(home, 'Applications')]) {
      const executable = join(dir, BUNDLE_EXECUTABLE)
      if (exists(executable)) return { kind: 'bundle', executable }
      tried.push(join(dir, 'Obsrv.app'))
    }
  }
  const entry = join(packageRoot, 'out', 'main', 'index.js')
  const electron = resolveElectron()
  if (electron.path && exists(entry)) return { kind: 'electron', electron: electron.path, entry }
  return {
    error:
      `no Obsrv.app in ${tried.join(' or ') || 'the usual places'}, and the package cannot run its own: ` +
      `${electron.error ?? (exists(entry) ? 'electron missing' : `${entry} missing (run npm run build)`)}`,
  }
}

/**
 * What a launch attempt hands back so a caller can notice the spawned
 * process ending, without keeping this process alive to watch it (the child
 * stays `unref`'d regardless).
 */
export interface LaunchHandle {
  /**
   * Resolves once the spawned process has exited or failed to start at all —
   * never rejects. A process that loses Obsrv's single-instance lock always
   * exits almost immediately; `ensureLive` (src/mcp/control.ts) uses that to
   * stop waiting on a launch that will never come up, rather than burning
   * the whole timeout (final-review fix for Finding 2).
   */
  exited: Promise<void>
}

/** Spawns the app, detached, with agent control force-enabled for the session. */
export function launchApp(target: LaunchTarget, env: NodeJS.ProcessEnv, spawn: typeof nodeSpawn = nodeSpawn): LaunchHandle {
  // Belt and braces with `cannotLaunchReason` (src/mcp/lib.ts): a launch from
  // inside the e2e harness would start a real Obsrv against the developer's
  // profile.
  if (env.OBSRV_TEST === '1') throw new Error('refusing to launch the app under OBSRV_TEST=1')
  const childEnv: NodeJS.ProcessEnv = { ...env, OBSRV_AGENT_CONTROL: '1' }
  // Must boot the real Electron runtime, not Node-mode (see bin/obsrv.js).
  delete childEnv.ELECTRON_RUN_AS_NODE
  const [command, args] = target.kind === 'bundle' ? [target.executable, []] : [target.electron, [target.entry]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', env: childEnv })
  const exited = new Promise<void>(resolve => {
    child.once('exit', () => resolve())
    child.once('error', () => resolve())
  })
  child.unref()
  return { exited }
}

/** The default resolution against the real filesystem and the package's own Electron. */
export function resolveDefaultTarget(): LaunchTarget | { error: string } {
  // bin/electronPath.js is plain CommonJS, shared with the CLI launcher.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveElectron } = require(resolve(__dirname, '..', '..', 'bin', 'electronPath.js')) as {
    resolveElectron: () => { path?: string; error?: string }
  }
  return resolveLaunchTarget(process.platform, homedir(), resolve(__dirname, '..', '..'), existsSync, resolveElectron)
}
