import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app with test hooks enabled, in a throwaway user-data
 * directory so specs that write settings cannot leak into later runs.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'obsrv-e2e-'))
  return electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, OBSRV_TEST: '1' },
  })
}
