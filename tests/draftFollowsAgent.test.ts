import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

// Browser storage, as the app sees it.
const store = new Map<string, string>()
globalThis.localStorage = {
  get length() { return store.size },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
} as Storage

const { adoptDrafts, draftAsText, moveDraft, noteDraftOwner, useDraft } = await import('../app/composables/useDraft')
const QUOTE = '↳ Quote point 15:50 ~k3f : Shall I tag the release today? —'

describe('a draft follows its agent', () => {
  beforeEach(() => store.clear())

  it('is stored with the keys of its agent', async () => {
    const d = useDraft('w1:p1')
    noteDraftOwner('w1:p1', ['session::a'])
    d.text = `${QUOTE}\nYes`
    await nextTick()
    expect(JSON.parse(store.get('draft:w1:p1')!)).toMatchObject({ text: `${QUOTE}\nYes`, who: ['session::a'] })
  })

  it('comes into the new pane of the same agent once the old one is closed', async () => {
    const d = useDraft('w2:p1')
    noteDraftOwner('w2:p1', ['coord::top:', 'session::b'])
    d.text = `${QUOTE}\nNot yet`
    d.atts.push({ url: '', path: null, paste: 'a long log' })
    await nextTick()
    // Still open: it stays where it is.
    expect(adoptDrafts('w2:p2', ['coord::top:'], new Set(['w2:p1', 'w2:p2']))).toBe(0)
    // Another agent never takes it.
    expect(adoptDrafts('w5:p1', ['session::z'], new Set(['w5:p1']))).toBe(0)
    expect(adoptDrafts('w2:p2', ['coord::top:'], new Set(['w2:p2']))).toBe(1)
    const now = useDraft('w2:p2')
    expect(now.text).toBe(`${QUOTE}\nNot yet`)
    expect(now.atts.map(a => a.paste)).toEqual(['a long log'])
    expect(useDraft('w2:p1').text).toBe('')
    await nextTick()
    expect(store.has('draft:w2:p1')).toBe(false)
    expect(JSON.parse(store.get('draft:w2:p2')!).who).toEqual(['coord::top:', 'session::b'])
  })

  it('keeps what the new field already holds, after the moved draft', () => {
    useDraft('w3:p1').text = 'old words'
    useDraft('w3:p2').text = 'new words'
    moveDraft('w3:p1', 'w3:p2')
    expect(useDraft('w3:p2').text).toBe('old words\nnew words')
  })

  it('copies as plain text with its pasted texts and attachments', () => {
    expect(draftAsText({ text: 'hello ', atts: [{ url: '', path: null, paste: 'log' }, { url: '/uploads/a.jpg', path: '/u/a.jpg', name: 'a.jpg' }, { url: '', path: '/f/n.md', name: 'n.md', file: { label: 'n.md', size: 1, kind: 'text' }, ref: '@/f/n.md' }] }))
      .toBe('hello\n\nlog\n\n/u/a.jpg\n\n@/f/n.md')
  })
})
