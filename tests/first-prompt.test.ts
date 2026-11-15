import { describe, expect, it } from 'vitest'
import { firstPromptOf, forgetFirstPrompt, rememberFirstPrompt } from '../app/utils/firstPrompt'

describe('first prompt kept for the chat', () => {
  it('keeps the trimmed text per pane until forgotten', () => {
    rememberFirstPrompt('s1:p1', '  hello ')
    rememberFirstPrompt('s1:p2', '   ')
    expect(firstPromptOf('s1:p1')).toBe('hello')
    expect(firstPromptOf('s1:p2')).toBe('')
    forgetFirstPrompt('s1:p1')
    expect(firstPromptOf('s1:p1')).toBe('')
  })
})
