import { describe, it, expect } from 'vitest'
import { normalizeUrl } from '../../src/shared/url'

describe('normalizeUrl', () => {
  it('leaves absolute URLs alone', () => {
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeUrl('file:///Users/me/x.html')).toBe('file:///Users/me/x.html')
    expect(normalizeUrl('about:blank')).toBe('about:blank')
  })
  it('defaults a bare host to https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('example.com/deep/path')).toBe('https://example.com/deep/path')
  })
  it('defaults loopback hosts to http, including a port', () => {
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeUrl('localhost')).toBe('http://localhost')
    expect(normalizeUrl('127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080/a')
  })
  it('treats an absolute filesystem path as file://', () => {
    expect(normalizeUrl('/Users/me/x.html')).toBe('file:///Users/me/x.html')
  })
  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
  })
  it('rejects empty input', () => {
    expect(() => normalizeUrl('   ')).toThrow(/empty url/)
  })
})
