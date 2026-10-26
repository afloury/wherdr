// WHR-116: a provider quota (Claude, Codex) says "Quota" in both languages;
// "Limit" / "Limite" stays for herdr-projects time and token ceilings.
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ fr: false }))
vi.mock('../app/utils/i18n', () => ({ tl: (en: string, fr: string) => (lang.fr ? fr : en) }))
const { finishHint } = await import('../app/utils/taskFinish')

describe('a task stopped at its herdr-projects limit', () => {
  it('speaks of a limit, kept apart from provider quotas, in English and French', () => {
    lang.fr = false
    expect(finishHint('limit')).toContain('Raising the limit')
    expect(finishHint('limit')).toContain('separate from provider quotas')
    lang.fr = true
    expect(finishHint('limit')).toContain('Relever la limite')
    expect(finishHint('limit')).toContain('distinctes des quotas fournisseur')
    lang.fr = false
  })
})
