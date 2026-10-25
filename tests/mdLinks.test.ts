import { describe, expect, it } from 'vitest'
import { headingSlug, isMarkdownPath, resolveLink } from '../app/utils/mdLinks'

describe('Markdown file links', () => {
  it('knows a Markdown file by its extension', () => {
    expect(isMarkdownPath('docs/README.md')).toBe(true)
    expect(isMarkdownPath('NOTES.Markdown')).toBe(true)
    expect(isMarkdownPath('notes.txt')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })

  it('resolves a relative link against the shown file, inside the browsed folder', () => {
    expect(resolveLink('docs/guide/intro.md', 'setup.md', false)).toEqual({ kind: 'file', path: 'docs/guide/setup.md', anchor: '' })
    expect(resolveLink('docs/guide/intro.md', './../api.md#auth-tokens', false)).toEqual({ kind: 'file', path: 'docs/api.md', anchor: 'auth-tokens' })
    expect(resolveLink('docs/intro.md', '../src/', false)).toEqual({ kind: 'dir', path: 'src', anchor: '' })
    expect(resolveLink('README.md', 'my%20notes.md?raw=1', false)).toEqual({ kind: 'file', path: 'my notes.md', anchor: '' })
    // From the folder's top, as on GitHub.
    expect(resolveLink('docs/intro.md', '/CHANGELOG.md', false)).toEqual({ kind: 'file', path: 'CHANGELOG.md', anchor: '' })
  })

  it('refuses a link that climbs out of the browsed folder', () => {
    expect(resolveLink('README.md', '../secret.md', false)).toEqual({ kind: 'outside' })
    expect(resolveLink('docs/a.md', '../../etc/passwd', false)).toEqual({ kind: 'outside' })
  })

  it('keeps an absolute path for a file named in a conversation', () => {
    expect(resolveLink('/home/user/notes/plan.md', 'todo.md', true)).toEqual({ kind: 'file', path: '/home/user/notes/todo.md', anchor: '' })
    expect(resolveLink('/home/user/notes/plan.md', '../img/a.png', true)).toEqual({ kind: 'file', path: '/home/user/img/a.png', anchor: '' })
    expect(resolveLink('/home/user/notes/plan.md', '~/other.md', true)).toEqual({ kind: 'file', path: '~/other.md', anchor: '' })
  })

  it('leaves web links alone and reads an anchor of the page', () => {
    for (const href of ['https://example.com/a.md', 'mailto:someone@example.com', '//example.com/x', 'javascript:alert(1)']) {
      expect(resolveLink('README.md', href, false)).toEqual({ kind: 'external' })
    }
    expect(resolveLink('README.md', '#getting-started', false)).toEqual({ kind: 'anchor', anchor: 'getting-started' })
    expect(resolveLink('README.md', '  ', false)).toBeNull()
  })

  it('makes heading anchors the way GitHub does', () => {
    expect(headingSlug('Getting Started')).toBe('getting-started')
    expect(headingSlug('  API: v2 (beta)! ')).toBe('api-v2-beta')
    expect(headingSlug('Écran d’accueil')).toBe('écran-daccueil')
  })
})
