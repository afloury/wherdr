import { describe, expect, it } from 'vitest'
import { currentModelOption, modelOptionCurrent } from '../app/utils/modelSelection'

describe('option du modèle courant', () => {
  it('reconnaît Opus 5.5 (1M) à partir de la description Claude et préfère la ligne explicite', () => {
    const options = [
      { label: 'Default (recommended)', hint: 'Opus 5.5 with 1M context · Best for everyday tasks' },
      { label: 'Opus (1M)', hint: 'Opus 5.5 with 1M context · Best for everyday tasks' },
      { label: 'Opus 5.5', hint: 'Most capable' },
    ]
    const model = { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5 (1M)', effort: 'medium' }
    expect(modelOptionCurrent(options[1]!, model)).toBe(true)
    expect(currentModelOption(options, model)).toBe(1)
    expect(modelOptionCurrent(options[2]!, model)).toBe(false)
  })

  it('reconnaît un modèle Codex sans description utile', () => {
    const options = [{ label: 'GPT-6-Sol', hint: 'Workhorse model' }, { label: 'GPT-6-Luna', hint: null }]
    expect(currentModelOption(options, { id: 'gpt-6-sol', label: 'GPT-6-Sol', effort: 'high' })).toBe(0)
  })
})
