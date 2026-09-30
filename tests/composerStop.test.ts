import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Bouton Stop du champ de saisie : UChatPromptSubmit déclare onClick comme prop
// et, en status « streaming » ou « submitted », la remplace par l'émission de
// « stop ». Un @click seul n'est donc jamais appelé en mode Stop : aucune
// requête /api/interrupt ne partait (clic sans effet).
const composer = readFileSync(join(__dirname, '../app/components/Composer.vue'), 'utf8')
const button = /<UChatPromptSubmit\b[\s\S]*?\/>/.exec(composer)?.[0] || ''
const submitSrc = readFileSync(join(__dirname, '../node_modules/@nuxt/ui/dist/runtime/components/ChatPromptSubmit.vue'), 'utf8')

describe('bouton Stop du champ de saisie', () => {
  it('Nuxt UI remplace le clic par « stop » en mode streaming', () => {
    // Si ce constat change (mise à jour de Nuxt UI), revoir le branchement ci-dessous.
    expect(submitSrc).toMatch(/streaming:\s*\{[\s\S]*?onClick\(e\)\s*\{\s*emits\(["']stop["']/)
  })
  it('le bouton passe en streaming en mode Stop', () => {
    expect(button).toMatch(/:status="stopMode \? 'streaming' : 'ready'"/)
  })
  it('« stop » déclenche l’interruption, le clic envoie toujours', () => {
    expect(button).toMatch(/@stop="interrupt"/)
    expect(button).toMatch(/@click="onSubmitClick"/)
    // interrupt() appelle bien l'API d'interruption.
    const fn = /async function interrupt\(\)[\s\S]*?\n\}/.exec(composer)?.[0] || ''
    expect(fn).toContain(`'/api/interrupt'`)
  })
})
