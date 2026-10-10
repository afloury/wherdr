import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { md } from '~/utils/markdown'
import { parseReplyStyle, replyTargets, withQuestions } from '~/utils/questionReply'

// The first call installs the app's renderers (inline code, code blocks).
md('')

// An agent reply as rendered in the conversation, with its "↳ Reply" buttons.
// Parsed like utils/markdown.ts, without DOMPurify (it empties the HTML on happy-dom).
function reply(markdown: string) {
  const host = document.createElement('div')
  const html = marked.parse(markdown, { breaks: true, gfm: true, async: false }) as string
  host.innerHTML = withQuestions(html, { reply: 'Reply', quoted: 'Quoted', discuss: 'Discuss', yes: 'Yes', no: 'No' })
  const buttons = [...host.querySelectorAll<HTMLElement>('.q-reply')]
  const quotes = buttons.map(b => b.dataset.q)
  const points = [...host.querySelectorAll<HTMLElement>('.q-point')]
  const markedHtml = host.innerHTML
  // The text as read, a "[↳]" where each button sits.
  for (const b of buttons) b.replaceWith('[↳]')
  return { host, html: markedHtml, buttons, quotes, points, pointQuotes: points.map(b => b.dataset.q), flow: (host.textContent || '').replace(/\s+/g, ' ').trim() }
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

describe('the words of a question', () => {
  const words = (host: HTMLElement, n: string) => [...host.querySelectorAll<HTMLElement>(`.q-text[data-n="${n}"]`)].map(s => s.textContent).join('')

  it('wraps each question, numbered like its button, in reading order', () => {
    const r = reply('Shall I push now? The build is green. Or do you want a review first? Both are fine.\n\nLast one: shall I tag it?')
    expect(r.buttons.map(b => b.dataset.n)).toEqual(['1', '2', '3'])
    expect(words(r.host, '1')).toBe('Shall I push now?')
    expect(words(r.host, '2')).toBe('Or do you want a review first?')
    expect(words(r.host, '3')).toBe('Last one: shall I tag it?')
    // Nothing else is wrapped, and the text reads the same.
    expect(r.host.querySelectorAll('.q-text')).toHaveLength(3)
    expect(r.flow).toBe('Shall I push now?[↳] The build is green. Or do you want a review first?[↳] Both are fine. Last one: shall I tag it?[↳]')
  })

  it('wraps a question across emphasis and inline code, text node by text node', () => {
    const r = reply('Done. Shall I run `npm test` on the **whole** suite? It takes two minutes.')
    expect(words(r.host, '1')).toBe('Shall I run npm test on the whole suite?')
    expect(r.host.querySelector('code .q-text')!.textContent).toBe('npm test')
    expect(r.host.querySelector('strong .q-text')!.textContent).toBe('whole')
    expect(r.host.querySelector('p')!.firstChild!.textContent).toBe('Done. ')
  })
})

describe('points of an agent reply', () => {
  it('marks a list item and a paragraph that ask nothing', () => {
    const r = reply('The build is green and the export is fixed.\n\n- The cache is cleared on deploy.\n- The export keeps its column order.')
    expect(r.pointQuotes).toEqual(['The build is green and the export is fixed.', 'The cache is cleared on deploy.', 'The export keeps its column order.'])
    expect(r.points.every(b => b.parentElement!.classList.contains('q-pt'))).toBe(true)
    expect(r.points[1]!.getAttribute('aria-label')).toBe('Discuss: The cache is cleared on deploy.')
    expect(r.points[1]!.dataset.l).toBe('Discuss')
    // The button closes the point; it holds no text.
    expect(r.points[1]!.parentElement!.lastChild).toBe(r.points[1])
    expect(r.points[1]!.textContent).toBe('')
  })

  it('leaves a block with a question to its question', () => {
    const r = reply('The build is green. Shall I push?\n\n- Do you want the logs?\n- The logs are kept for a week.')
    expect(r.quotes).toEqual(['Shall I push?', 'Do you want the logs?'])
    expect(r.pointQuotes).toEqual(['The logs are kept for a week.'])
    expect(r.host.querySelectorAll('.q-pt')).toHaveLength(1)
  })

  it('skips an introduction ending with a colon and a point of one or two words', () => {
    const r = reply('Three things to note:\n\n- Done.\n- Tests pass.\n- The export keeps its column order.\n\nTrois points à noter :')
    expect(r.pointQuotes).toEqual(['The export keeps its column order.'])
  })

  it('skips code, tables, quotes and titles', () => {
    const r = reply('## The plan for this week\n\n> The export keeps its column order.\n\n| Choice | What it does |\n|---|---|\n| System | follows the system setting |\n\n```\nthe cache is cleared on deploy\n```')
    expect(r.pointQuotes).toEqual([])
    expect(r.host.querySelectorAll('.q-pt')).toHaveLength(0)
  })

  it('puts the button of a list item before its sub-list, and gives the paragraphs of a loose item theirs', () => {
    const nested = reply('- The export keeps its column order.\n  - The header row stays first.')
    expect(nested.pointQuotes).toEqual(['The export keeps its column order.', 'The header row stays first.'])
    expect(nested.points[0]!.nextElementSibling!.tagName).toBe('UL')

    const loose = reply('- The export keeps its column order.\n\n  The header row stays first.\n\n- The cache is cleared on deploy.')
    expect(loose.pointQuotes).toEqual(['The export keeps its column order.', 'The header row stays first.', 'The cache is cleared on deploy.'])
    expect(loose.points.every(b => b.parentElement!.tagName === 'P')).toBe(true)
  })

  it('quotes the words of a point on one line', () => {
    const r = reply('- The limits come from `req.plan.limits`,\n  60 a minute on **Free**.')
    expect(r.pointQuotes).toEqual(['The limits come from req.plan.limits, 60 a minute on Free.'])
  })
})

describe('what the list style shows under a reply', () => {
  it('lists the questions in order and counts the points', () => {
    const r = reply('Shall I push now? The build is green. Or do you want a review first?\n\n- The cache is cleared on deploy.\n- The export keeps its column order.')
    expect(replyTargets(r.html)).toEqual({
      questions: [{ n: '1', text: 'Shall I push now?', closed: true }, { n: '2', text: 'Or do you want a review first?', closed: false }],
      points: 2,
      pick: true,
    })
  })

  it('is empty for a reply with nothing to quote', () => {
    expect(replyTargets(reply('Done.').html)).toEqual({ questions: [], points: 0, pick: false })
  })

  it('does not offer to pick a point in a reply of plain prose', () => {
    const prose = replyTargets(reply('Nothing is blocked, the state is unchanged. I am still waiting for your answers.').html)
    expect(prose).toEqual({ questions: [], points: 1, pick: false })
    // A question next to a single paragraph: the question is listed, no pick.
    const asked = replyTargets(reply('The build is green on every platform.\n\nShall I push now?').html)
    expect(asked.questions).toHaveLength(1)
    expect(asked).toMatchObject({ points: 1, pick: false })
  })

  it('offers to pick a point when there is a choice: a list item, or several points', () => {
    expect(replyTargets(reply('Here is what changed:\n\n- The cache is cleared on deploy.').html)).toMatchObject({ points: 1, pick: true })
    expect(replyTargets(reply('1. The cache is cleared on deploy.\n2. The export keeps its column order.').html)).toMatchObject({ points: 2, pick: true })
    expect(replyTargets(reply('The cache is cleared on deploy.\n\nThe export keeps its column order.').html)).toMatchObject({ points: 2, pick: true })
  })
})

describe('one-tap answers of a closed question', () => {
  const answers = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.q-ans')].map(b => [b.dataset.a, b.dataset.q, b.dataset.l, b.getAttribute('aria-label')])

  it('adds Yes and No right after the Reply button of a closed question', () => {
    const r = reply('I added the task to the queue. Shall I start step 1 now? A slot is free.')
    expect(answers(r.host)).toEqual([
      ['yes', 'Shall I start step 1 now?', 'Yes', 'Yes: Shall I start step 1 now?'],
      ['no', 'Shall I start step 1 now?', 'No', 'No: Shall I start step 1 now?'],
    ])
    const p = r.host.querySelector('p')!
    // Reply, Yes, No, then the sentence that follows; no text node of their own.
    expect([...p.children].map(c => c.className)).toEqual(['q-text', 'q-ans q-yes', 'q-ans q-no'])
    expect(r.flow).toBe('I added the task to the queue. Shall I start step 1 now?[↳] A slot is free.')
    expect(replyTargets(r.html).questions).toEqual([{ n: '1', text: 'Shall I start step 1 now?', closed: true }])
  })

  it('leaves an open question, an alternative and a double question with Reply alone', () => {
    const r = reply('Which branch shall I use?\n\nShall I push or wait?\n\nShall I push? Or wait for review?\n\nShall I merge the branch now?')
    expect(r.quotes).toHaveLength(4)
    expect(answers(r.host).map(a => a[1])).toEqual(['Shall I merge the branch now?', 'Shall I merge the branch now?'])
    expect(replyTargets(r.html).questions.map(q => q.closed)).toEqual([false, false, false, true])
  })

  it('keeps the answers after the emphasis a question ends in', () => {
    const r = reply('Can you plug the box in over **Ethernet?** It is faster.')
    const p = r.host.querySelector('p')!
    expect([...p.children].map(c => c.tagName === 'STRONG' ? 'strong' : c.className)).toEqual(['q-text', 'strong', 'q-ans q-yes', 'q-ans q-no'])
  })
})

describe('the reply style setting', () => {
  it('reads the three styles and falls back to the icon', () => {
    expect(['icon', 'text', 'list'].map(parseReplyStyle)).toEqual(['icon', 'text', 'list'])
    expect([null, undefined, '', 'tag'].map(parseReplyStyle)).toEqual(['icon', 'icon', 'icon', 'icon'])
  })
})
