import { describe, expect, it } from 'vitest'
import { currentModelOption, modelOptionCurrent } from '../app/utils/modelSelection'

describe('current model option', () => {
  it('recognizes Opus 5.5 (1M) from the Claude description and prefers the explicit row', () => {
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

  it('recognizes a Codex model without a useful description', () => {
    const options = [{ label: 'GPT-6-Sol', hint: 'Workhorse model' }, { label: 'GPT-6-Luna', hint: null }]
    expect(currentModelOption(options, { id: 'gpt-6-sol', label: 'GPT-6-Sol', effort: 'high' })).toBe(0)
  })
})
