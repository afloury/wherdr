import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexError } from '../shared/codexError'
import { lastLine } from '../server/utils/corePreview'
import { readCoreScreen } from '../server/utils/coreScreen'

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}.txt`, import.meta.url), 'utf8')

describe('codexError', () => {
  it('joins the wrapped error above the input field', () => {
    expect(codexError(fixture('codex-usage-limit'))).toBe('You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 8th, 2026 2:52 PM.')
  })
  it('is null on a healthy screen, and for an error followed by a newer turn', () => {
    expect(codexError(fixture('codex-idle'))).toBeNull()
    expect(codexError(`■ Network error\n\n› hello\n\n• hi there\n\n› Ask Codex to do anything\n`)).toBeNull()
  })
  it('keeps the screen an idle input for the status logic', () => {
    expect(readCoreScreen(fixture('codex-usage-limit'), 'codex', 'idle').interaction).not.toBe('native')
  })
})

describe('card preview of an idle Codex', () => {
  it('shows no empty prompt nor status line', () => {
    expect(lastLine(fixture('codex-idle'))).toBe('21:30')
    // Real screens (Codex 0.166, Claude Code 2.1.x): nothing but chrome.
    expect(lastLine(fixture('claude-idle-effort'))).toContain('~/sandbox')
    expect(lastLine('Done\n\n› Ask Codex to do anything\n\n  ◐ medium · /effort')).toBe('Done')
    expect(lastLine('◐ medium · /effort\n› Ask Codex to do anything')).toBeNull()
    expect(lastLine('Medium effort is the default')).toBe('Medium effort is the default')
  })
})
