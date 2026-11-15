import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { terminalException } from '../shared/interactiveScreen'
const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')
it('recognizes usage with its subtitle and old output above it', () => {
  expect(terminalException('Old MCP tools\n\n' + fx('codex-usage-subtitle.txt'))).toBe(true)
  expect(terminalException(fx('codex-usage-subtitle.txt') + '\nNew question?\n› 1. Yes\n  2. No')).toBe(false)
})
