import { net } from 'electron'
import type { UpdateState } from '../shared/types'
import { CHECK_TIMEOUT_MS, RELEASES_API, readRelease } from '../shared/update'

/**
 * One bounded GET against the releases API. Never throws and never retries:
 * every failure — offline, timeout, non-200, unparseable, a URL that fails the
 * allowlist — collapses to `status: 'error'`, which the toolbar ignores.
 *
 * `OBSRV_RELEASES_API` overrides the endpoint. The e2e suite points it at a
 * loopback server so no test touches the network; it is also the seam for a
 * fork that publishes elsewhere.
 */
export async function checkForUpdate(current: string, now: number): Promise<{ state: UpdateState; url: string }> {
  const failed = { state: { status: 'error', current, checkedAt: now } as UpdateState, url: '' }
  const endpoint = process.env.OBSRV_RELEASES_API ?? RELEASES_API

  return new Promise(resolve => {
    let settled = false
    const done = (v: { state: UpdateState; url: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }

    let request: Electron.ClientRequest
    try {
      request = net.request({ method: 'GET', url: endpoint })
    } catch {
      // A malformed OBSRV_RELEASES_API throws synchronously; still not fatal.
      resolve(failed)
      return
    }

    const timer = setTimeout(() => {
      request.abort()
      done(failed)
    }, CHECK_TIMEOUT_MS)

    // GitHub wants a UA and answers v3 JSON; neither carries an identifier.
    request.setHeader('accept', 'application/vnd.github+json')
    request.setHeader('user-agent', 'obsrv-update-check')

    request.on('response', response => {
      if (response.statusCode !== 200) {
        response.on('data', () => undefined)
        response.on('end', () => done(failed))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', c => chunks.push(Buffer.from(c)))
      response.on('end', () => {
        const parsed = readRelease(Buffer.concat(chunks).toString('utf8'), current, now)
        done(parsed ?? failed)
      })
      response.on('error', () => done(failed))
    })
    request.on('error', () => done(failed))
    request.on('abort', () => done(failed))
    request.end()
  })
}
