// "Cancel" a queued message in Claude Code: reading the input field from the
// screen, and ↑ / clear / requeue sequence played against a
// fake Claude imitating the observed one (2.1.283, hwtest session).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clearKeys, inputBox, msgText } from '../server/utils/unqueue'
import { restoreDraft } from '../app/utils/queuedCancel'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const E = '\x1b'
const RULE = `${E}[38;2;80;80;80m${'─'.repeat(40)}${E}[0m\r`
// ANSI screens captured on the real Claude Code (simplified).
const queuedLine = (t: string) => `${E}[0m${E}[38;2;80;80;80m${E}[48;2;55;55;55m❯ ${E}[0m${E}[38;2;153;153;153m${E}[48;2;55;55;55m${t}${E}[0m\r`
const screen = (queue: string[], input: string[]) => [
  '  12. La mer est salée.',
  ...queue.map(queuedLine),
  RULE,
  input.length
    ? [`${E}[0m${E}[38;2;153;153;153m❯ ${E}[0m${input[0]}\r`, ...input.slice(1).map(l => `  ${l}\r`)].join('\n')
    : `${E}[0m${E}[38;2;153;153;153m❯ ${E}[0m${queue.length ? `${E}[2mPress up to edit queued messages${E}[0m` : ''}\r`,
  RULE,
  '  ⏸ manual mode on · ← for agents',
].join('\n')

describe('champ de saisie de Claude Code', () => {
  it('empty, with or without grayed-out help text', () => {
    expect(inputBox(screen([], []))).toBe('')
    expect(inputBox(screen(['Message en file'], []))).toBe('')
  })
  it('reads the typed text, over several lines, without confusing the queue', () => {
    expect(inputBox(screen(['A'], ['Premier en file', '[Pasted text #1 +11 lines]']))).toBe('Premier en file\n[Pasted text #1 +11 lines]')
    expect(inputBox('❯ abc\r')).toBe('abc')
  })
  it('not found (menu, other screen)', () => {
    expect(inputBox('Do you trust this folder?\n❯ 1. Yes')).toBeNull()
  })
  // Fresh Claude Code 2.1.292 (hwtest session): 'Try "…"' placeholder.
  it('a fresh session\'s placeholder is not typed text, in color or not', () => {
    expect(inputBox(fx('claude-field-placeholder.ansi'))).toBe('')
    expect(inputBox(fx('claude-field-placeholder-nocolor.txt'))).toBe('')
  })
  it('a real draft is typed text, even with a grayed-out completion after it', () => {
    expect(inputBox(fx('claude-field-draft.ansi'))).toBe('draft text')
    const ghost = fx('claude-field-draft.ansi').replace('draft text', `draft te${E}[0m${E}[2;38;5;244mxt to complete${E}[0m`)
    expect(inputBox(ghost)).toBe('draft te')
    // Dim switched off by SGR 22 only: what follows is typed again.
    expect(inputBox(`❯\u00a0 ${E}[2mhint${E}[22m typed\r`)).toBe('typed')
  })
  it('a colored screen keeps a typed "Try …" text', () => {
    expect(inputBox(fx('claude-field-draft.ansi').replace('draft text', 'Try "this"'))).toBe('Try "this"')
    const plain = fx('claude-field-placeholder-nocolor.txt')
    expect(inputBox(plain.replace(/Try "[^"]*"/, 'draft text'))).toBe('draft text')
  })
  it('clearing keys: Ctrl+U then Backspace per line, bounded', () => {
    expect(clearKeys(1)).toEqual(['ctrl+u', 'backspace', 'ctrl+u', 'backspace', 'ctrl+u', 'backspace'])
    expect(clearKeys(10000).length).toBe(400)
  })
  it('texte sans chemins de photos', () => {
    expect(msgText('Regarde\n/home/user/.cache/herdr-web/uploads/a.jpg')).toBe('Regarde')
  })
})

describe('bouton et brouillon', () => {
  it('text put back before the draft, photos attached only once', () => {
    const d = { text: 'déjà tapé', atts: [] as { url: string, path: string | null, name?: string }[] }
    const msg = 'Regarde ça\n/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg'
    restoreDraft(d, msg)
    restoreDraft(d, msg)
    expect(d.text).toBe('Regarde ça\nRegarde ça\ndéjà tapé')
    expect(d.atts).toEqual([{ url: '/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', path: '/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', name: '2026-09-26T00-36-39-393Z-4fa305.jpg' }])
  })
  it('photos only: the photos come back, no text', () => {
    const d = { text: '', atts: [] as { url: string, path: string | null, name?: string }[] }
    restoreDraft(d, '/home/user/.cache/herdr-web/uploads/a.jpg\n/home/user/.cache/herdr-web/uploads/b.jpg')
    expect(d.text).toBe('')
    expect(d.atts.map(a => a.name)).toEqual(['a.jpg', 'b.jpg'])
  })
  it('photos and attached files together, with the reply marker of an earlier version', () => {
    const d = { text: '', atts: [] as { url: string, path: string | null, name?: string, file?: unknown, ref?: string }[], reply: null as unknown }
    restoreDraft(d as never, '↳ Replying to your message from 14:22 ("La mer")\n\nRegarde\n/home/user/.cache/herdr-web/uploads/a.jpg\n@/home/user/.cache/herdr-web/files/notes.md')
    expect(d.text).toBe('↳ Quote message 14:22 : La mer —\nRegarde')
    expect(d.atts.map(a => [a.name, Boolean(a.file)])).toEqual([['a.jpg', false], ['notes.md', true]])
  })
})
