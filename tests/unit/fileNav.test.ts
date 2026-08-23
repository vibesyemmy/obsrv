import { describe, it, expect } from 'vitest'
import { classifyFileNavigation } from '../../src/shared/fileNav'

describe('classifyFileNavigation', () => {
  it('never touches remote navigations', () => {
    expect(classifyFileNavigation('https://a.test/', 'https://b.test/')).toBe('allow')
    expect(classifyFileNavigation('file:///x.html', 'https://b.test/')).toBe('allow')
  })
  it('reports a dropped design export wherever it lands', () => {
    expect(classifyFileNavigation('https://a.test/', 'file:///Users/me/hero@2x.png')).toBe('image')
    expect(classifyFileNavigation('file:///x.html', 'file:///Users/me/shot.JPG')).toBe('image')
    expect(classifyFileNavigation('about:blank', 'file:///a/b.jpeg?x=1#y')).toBe('image')
  })
  it('blocks other local files dropped on a remote page', () => {
    expect(classifyFileNavigation('https://a.test/', 'file:///etc/hosts')).toBe('block')
    expect(classifyFileNavigation('about:blank', 'file:///Users/me/page.html')).toBe('block')
  })
  it('lets a local page reach a sibling local page', () => {
    expect(classifyFileNavigation('file:///f/redirect.html', 'file:///f/hairline.html')).toBe('allow')
  })
})
