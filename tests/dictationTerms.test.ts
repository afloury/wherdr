import { describe, expect, it } from 'vitest'
import { dictationTerms } from '../app/utils/dictation/terms'

describe('dictationTerms', () => {
  it('lists the pane identity, folder and files, then names from the text', () => {
    expect(dictationTerms({
      agent: 'Claude', machine: 'laptop', name: 'api-fix', cwd: '/srv/code/wherdr/app',
      files: ['/tmp/shots/home.png'],
      draft: 'fix useDraft in the composer',
      recent: ['old message about herdr-core', 'run npm test on v3.'],
    })).toEqual(['Claude', 'laptop', 'api-fix', 'wherdr', 'app', 'home.png', 'useDraft', 'v3', 'herdr-core'])
  })

  it('drops duplicates and words of plain language, in any script', () => {
    expect(dictationTerms({ agent: 'codex', title: 'Codex', draft: 'Bonjour, ça marche très bien' })).toEqual(['codex'])
  })

  it('keeps to the budget', () => {
    const recent = [Array.from({ length: 200 }, (_, i) => `term${i}`).join(' ')]
    const terms = dictationTerms({ recent })
    expect(terms.join('').length).toBeLessThanOrEqual(400)
    expect(terms[0]).toBe('term0')
  })
})
