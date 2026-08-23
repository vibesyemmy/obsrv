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
