import { describe, it, expect } from 'vitest'
import {
  CHECK_INTERVAL_MS,
  formatAge,
  isCheckDue,
  isNewer,
  isReleaseUrl,
  readRelease,
} from '../../src/shared/update'

const NOW = 1_700_000_000_000

function payload(tag: string, url = 'https://github.com/vibesyemmy/obsrv/releases/tag/' + tag): string {
  return JSON.stringify({ tag_name: tag, html_url: url, name: 'Obsrv ' + tag })
}

describe('isNewer', () => {
  it('compares numeric segments', () => {
    expect(isNewer('0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.6.1', '0.6.0')).toBe(true)
    expect(isNewer('0.6.0', '0.6.0')).toBe(false)
    expect(isNewer('0.5.9', '0.6.0')).toBe(false)
  })
  it('tolerates a v prefix on either side', () => {
    expect(isNewer('v0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('v0.6.0', 'v0.6.0')).toBe(false)
  })
  it('treats a missing segment as zero', () => {
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.1', '1.2')).toBe(true)
  })
  it('sorts a prerelease below the same version without one', () => {
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewer('1.0.0-rc.2', '0.9.0')).toBe(true)
  })
  it('returns false rather than throwing on garbage', () => {
    expect(isNewer('', '0.6.0')).toBe(false)
    expect(isNewer('not-a-version', '0.6.0')).toBe(false)
    expect(isNewer('0.7.0', '')).toBe(false)
  })
})

describe('readRelease', () => {
  it('reports an available update with the version and URL', () => {
    const out = readRelease(payload('v0.7.0'), '0.6.0', NOW)
    expect(out).toEqual({
      state: { status: 'available', current: '0.6.0', latest: '0.7.0', checkedAt: NOW },
      url: 'https://github.com/vibesyemmy/obsrv/releases/tag/v0.7.0',
    })
  })
  it('reports current when the release is not newer', () => {
    const out = readRelease(payload('v0.6.0'), '0.6.0', NOW)
    expect(out).toEqual({ state: { status: 'current', current: '0.6.0', checkedAt: NOW }, url: '' })
  })
  it('rejects a body that is not JSON', () => {
    expect(readRelease('<html>rate limited</html>', '0.6.0', NOW)).toBeNull()
  })
  it('rejects a body with no usable tag', () => {
    expect(readRelease(JSON.stringify({ name: 'x' }), '0.6.0', NOW)).toBeNull()
    expect(readRelease(JSON.stringify({ tag_name: 42 }), '0.6.0', NOW)).toBeNull()
  })
  it('rejects an update whose URL is not on the releases path', () => {
    expect(readRelease(payload('v0.7.0', 'https://evil.test/x'), '0.6.0', NOW)).toBeNull()
  })
})

describe('isReleaseUrl', () => {
  it('accepts the real release URLs', () => {
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/releases/tag/v0.7.0')).toBe(true)
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/releases/latest')).toBe(true)
  })
  it('refuses anything else', () => {
    expect(isReleaseUrl('http://github.com/vibesyemmy/obsrv/releases/tag/v1')).toBe(false)
    expect(isReleaseUrl('https://github.com.evil.test/vibesyemmy/obsrv/releases/x')).toBe(false)
    expect(isReleaseUrl('https://github.com/vibesyemmy/obsrv/issues/1')).toBe(false)
    expect(isReleaseUrl('https://github.com/someone/else/releases/tag/v1')).toBe(false)
    expect(isReleaseUrl('file:///etc/passwd')).toBe(false)
    expect(isReleaseUrl('not a url')).toBe(false)
  })
})

describe('isCheckDue', () => {
  it('is due when never checked', () => {
    expect(isCheckDue(0, NOW)).toBe(true)
  })
  it('is not due a minute after a check', () => {
    expect(isCheckDue(NOW - 60_000, NOW)).toBe(false)
  })
  it('is due once the interval has passed', () => {
    expect(isCheckDue(NOW - CHECK_INTERVAL_MS - 1, NOW)).toBe(true)
  })
  it('is due when the stamp is in the future, so a clock change cannot lock it out', () => {
    expect(isCheckDue(NOW + CHECK_INTERVAL_MS * 10, NOW)).toBe(true)
  })
})

describe('formatAge', () => {
  it('describes the gap in the largest sensible unit', () => {
    expect(formatAge(0, NOW)).toBe('never')
    expect(formatAge(NOW - 5_000, NOW)).toBe('just now')
    expect(formatAge(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(formatAge(NOW - 120_000, NOW)).toBe('2 minutes ago')
    expect(formatAge(NOW - 3_600_000, NOW)).toBe('1 hour ago')
    expect(formatAge(NOW - 7_200_000, NOW)).toBe('2 hours ago')
    expect(formatAge(NOW - 86_400_000, NOW)).toBe('1 day ago')
    expect(formatAge(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago')
  })
  it('reads a future stamp as just now rather than a negative age', () => {
    expect(formatAge(NOW + 60_000, NOW)).toBe('just now')
  })
})
