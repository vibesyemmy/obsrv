/** `scheme:` prefix, e.g. `https:`, `about:`, `file:`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Loopback host with optional port, e.g. `localhost:5173`, `127.0.0.1/a`. */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

/**
 * Turn URL-bar input into an absolute, loadable URL.
 * Loopback is checked before the scheme test because `localhost:5173`
 * parses as scheme `localhost` otherwise.
 */
export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (s === '') throw new Error('empty url')
  if (/\s/.test(s)) throw new Error('invalid URL')
  if (s.startsWith('/')) return `file://${s}`
  if (LOOPBACK.test(s)) return `http://${s}`
  if (SCHEME.test(s)) return s
  return `https://${s}`
}

/** Schemes an agent-facing entry point (MCP tool, control server) may load. */
export const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'file:'] as const

/**
 * Rejects URLs whose explicit scheme is outside the allowlist (javascript:,
 * data:, chrome:, …) with an actionable message, or returns null when the URL
 * may proceed. Scheme-relative (`//host`), bare-host (`example.com/page`) and
 * host:port (`localhost:5173`) forms pass — they normalise to http(s)
 * downstream. Shared by the MCP tools and the agent-control server, so the
 * app's URL bar stays the only surface that can reach another scheme.
 */
export function urlSchemeError(url: string): string | null {
  const trimmed = url.trim()
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!match) return null // bare host or scheme-relative
  const scheme = `${match[1]!.toLowerCase()}:`
  if ((ALLOWED_URL_SCHEMES as readonly string[]).includes(scheme)) return null
  // `localhost:5173`-style host:port, not a scheme: the "scheme" is followed
  // by a bare port number.
  if (/^[a-z0-9.-]+:\d+(\/|$)/i.test(trimmed)) return null
  return (
    `unsupported URL scheme "${scheme}" — obsrv renders ` +
    `${ALLOWED_URL_SCHEMES.map(s => `${s}//`).join(', ')} URLs only ` +
    `(bare hosts like example.com also work; they normalise to http(s)).`
  )
}
