import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Stop button of the input field: UChatPromptSubmit declares onClick as a prop
// and, in "streaming" or "submitted" status, replaces it with emitting
// "stop". A bare @click is therefore never called in Stop mode: no
// /api/interrupt request went out (click without effect).
const composer = readFileSync(join(__dirname, '../app/components/Composer.vue'), 'utf8')
const button = /<UChatPromptSubmit\b[\s\S]*?\/>/.exec(composer)?.[0] || ''
const submitSrc = readFileSync(join(__dirname, '../node_modules/@nuxt/ui/dist/runtime/components/ChatPromptSubmit.vue'), 'utf8')

describe('bouton Stop du champ de saisie', () => {
  it('Nuxt UI replaces the click with "stop" in streaming mode', () => {
    // If this finding changes (Nuxt UI update), revisit the wiring below.
    expect(submitSrc).toMatch(/streaming:\s*\{[\s\S]*?onClick\(e\)\s*\{\s*emits\(["']stop["']/)
  })
  it('le bouton passe en streaming en mode Stop', () => {
    expect(button).toMatch(/:status="stopMode \? 'streaming' : 'ready'"/)
  })
  it('"stop" triggers the interruption, the click still sends', () => {
    expect(button).toMatch(/@stop="interrupt"/)
    expect(button).toMatch(/@click="onSubmitClick"/)
    // interrupt() does call the interrupt API.
    const fn = /async function interrupt\(\)[\s\S]*?\n\}/.exec(composer)?.[0] || ''
    expect(fn).toContain(`'/api/interrupt'`)
  })
})
