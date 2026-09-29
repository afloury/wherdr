import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClaudeSuggestion } from '../server/utils/claudeScreen'

const fx = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8')
const E = '\x1b'
const RULE = `${E}[0m${E}[38;2;136;136;136m${'─'.repeat(40)}${E}[0m`
const box = (line: string) => ['● Fini.', '', RULE, line, RULE, '  ? for shortcuts'].join('\r\n')

describe('parseClaudeSuggestion', () => {
  it('lit la suggestion grisée du champ', () => {
    expect(parseClaudeSuggestion(fx('claude-suggestion.ansi'))).toBe('Oui, pousse la branche')
  })
  it('ignore un texte tapé (non grisé)', () => {
    expect(parseClaudeSuggestion(box('❯ Oui, pousse la branche'))).toBeNull()
    expect(parseClaudeSuggestion(box(`❯ ${E}[0mOui ${E}[2mgris${E}[0m`))).toBeNull()
  })
  it('champ vide ou aide grisée : pas de suggestion', () => {
    expect(parseClaudeSuggestion(box('❯ '))).toBeNull()
    expect(parseClaudeSuggestion(box(`❯  ${E}[0m${E}[2mPress up to edit queued messages${E}[0m`))).toBeNull()
    expect(parseClaudeSuggestion('')).toBeNull()
    expect(parseClaudeSuggestion(null)).toBeNull()
  })
  it('ligne « ❯ » hors du cadre (message déjà parti) : ignorée', () => {
    expect(parseClaudeSuggestion(`❯  ${E}[2mancien${E}[0m\r\nsuite`)).toBeNull()
  })
})
