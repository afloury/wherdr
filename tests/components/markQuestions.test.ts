import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { md } from '~/utils/markdown'
import { withQuestions } from '~/utils/questionReply'

// The first call installs the app's renderers (inline code, code blocks).
md('')

// An agent reply as rendered in the conversation, with its "↳ Reply" buttons.
// Parsed like utils/markdown.ts, without DOMPurify (it empties the HTML on happy-dom).
function reply(markdown: string) {
  const host = document.createElement('div')
  const html = marked.parse(markdown, { breaks: true, gfm: true, async: false }) as string
  host.innerHTML = withQuestions(html, { reply: 'Reply', quoted: 'Quoted' })
  const buttons = [...host.querySelectorAll<HTMLElement>('.q-reply')]
  const quotes = buttons.map(b => b.dataset.q)
  // The text as read, a "[↳]" where each button sits.
  for (const b of buttons) b.replaceWith('[↳]')
  return { host, buttons, quotes, flow: (host.textContent || '').replace(/\s+/g, ' ').trim() }
}

describe('question buttons in an agent reply', () => {
  it('puts the button right after a question in the middle of a paragraph', () => {
    const en = reply('I added the task to the queue, to be confirmed. Shall I start step 1 now? A slot is free on the server.')
    expect(en.quotes).toEqual(['Shall I start step 1 now?'])
    expect(en.flow).toBe('I added the task to the queue, to be confirmed. Shall I start step 1 now?[↳] A slot is free on the server.')
    expect(en.buttons[0]!.className).toBe('q-reply q-mid')
    expect(en.buttons[0]!.getAttribute('aria-label')).toBe('Reply: Shall I start step 1 now?')

    const fr = reply('J’ai noté la tâche dans « En file », à valider. Je lance l’étape 1 maintenant ? Une place est libre sur le serveur.')
    expect(fr.quotes).toEqual(['Je lance l’étape 1 maintenant ?'])
    expect(fr.flow).toBe('J’ai noté la tâche dans « En file », à valider. Je lance l’étape 1 maintenant ?[↳] Une place est libre sur le serveur.')
  })

  it('keeps the button at the end for a question that ends its paragraph', () => {
    const r = reply('The build is green. Shall I push?')
    expect(r.quotes).toEqual(['Shall I push?'])
    expect(r.flow).toBe('The build is green. Shall I push?[↳]')
    expect(r.buttons[0]!.className).toBe('q-reply')
  })

  it('gives each question of a paragraph its own button, in order', () => {
    const en = reply('Shall I push now? The build is green. Or do you want a review first? Both are fine.')
    expect(en.quotes).toEqual(['Shall I push now?', 'Or do you want a review first?'])
    expect(en.flow).toBe('Shall I push now?[↳] The build is green. Or do you want a review first?[↳] Both are fine.')

    const fr = reply('Je pousse maintenant ? Le build est vert. Tu préfères relire avant ? Ou attendre demain ?')
    expect(fr.quotes).toEqual(['Je pousse maintenant ?', 'Tu préfères relire avant ? Ou attendre demain ?'])
    expect(fr.flow).toBe('Je pousse maintenant ?[↳] Le build est vert. Tu préfères relire avant ? Ou attendre demain ?[↳]')
    expect(fr.buttons.map(b => b.className)).toEqual(['q-reply q-mid', 'q-reply'])
  })

  it('quotes the words as read, and stays out of the emphasis, link or code a question ends in', () => {
    const bold = reply('Done. Do you want the **short version?** It fits on one screen.')
    expect(bold.quotes).toEqual(['Do you want the short version?'])
    expect(bold.host.querySelector('strong')!.querySelector('.q-reply')).toBeNull()
    expect(bold.flow).toBe('Done. Do you want the short version?[↳] It fits on one screen.')

    const code = reply('Shall I run `npm test`? It takes two minutes.')
    expect(code.quotes).toEqual(['Shall I run npm test?'])
    expect(code.flow).toBe('Shall I run npm test?[↳] It takes two minutes.')

    const link = reply('Did you read [the notes](https://example.com/notes?page=2)? They list the changes.')
    expect(link.quotes).toEqual(['Did you read the notes?'])
    expect(link.host.querySelector('a')!.querySelector('.q-reply')).toBeNull()
  })

  it('handles list items like paragraphs, before their sub-list', () => {
    const r = reply('- Can you plug the box in over Ethernet? Over Wi-Fi the copy takes 30 hours.\n  - a detail\n- Nothing to ask here.')
    expect(r.quotes).toEqual(['Can you plug the box in over Ethernet?'])
    expect(r.flow).toBe('Can you plug the box in over Ethernet?[↳] Over Wi-Fi the copy takes 30 hours. a detail Nothing to ask here.')
  })

  it('reads a line break as a space', () => {
    const r = reply('All tests pass.\nShall I push? Nothing else is pending.')
    expect(r.quotes).toEqual(['Shall I push?'])
  })

  it('ignores a "?" in inline code or a code block', () => {
    expect(reply('The regex is `\\d+?` Then it stops. I kept it.').quotes).toEqual([])
    expect(reply('Call `isReady?` It returns a boolean.').quotes).toEqual([])
    expect(reply('J’appelle `estPrêt ?` Elle renvoie un booléen.').quotes).toEqual([])
    expect(reply('Here is the check:\n\n```js\nconst ok = ready ? 1 : 0 // really? Yes.\n```\n\nIt is merged.').quotes).toEqual([])
  })

  it('ignores a "?" in a URL', () => {
    expect(reply('The page is at https://example.com/search?x=1 and it loads. I checked it twice.').quotes).toEqual([])
    expect(reply('La page est sur https://example.com/recherche?x=1 et elle répond. Je l’ai vérifiée.').quotes).toEqual([])
    expect(reply('See [the search](https://example.com/search?x=1) for details. It is live.').quotes).toEqual([])
  })

  it('ignores quoted text, titles and tables', () => {
    expect(reply('You wrote:\n\n> Can it be faster? I need it today.\n\nIt is twice as fast now.').quotes).toEqual([])
    expect(reply('Tu as écrit :\n\n> On peut aller plus vite ? J’en ai besoin aujourd’hui.\n\nC’est fait.').quotes).toEqual([])
    expect(reply('You asked "can it be faster?" earlier. It is twice as fast now.').quotes).toEqual([])
    expect(reply('Tu as demandé « on peut aller plus vite ? » hier. C’est fait.').quotes).toEqual([])
    expect(reply('## What changed? A summary\n\nThe cache expires now.').quotes).toEqual([])
    expect(reply('## Qu’est-ce qui change ? Résumé\n\nLe cache expire.').quotes).toEqual([])
    expect(reply('| Question | Answer |\n|---|---|\n| Is it fast? Mostly. | Yes |').quotes).toEqual([])
  })
})
