import { describe, expect, it } from 'vitest'
import { addAnswer, addQuote, answerOf, decisionRows, hasOkAll, isClosedQuestion, rowAnswer, rowQuote, rowSettled, setRowAnswer, toggleOkAll, unansweredCount, isQuoted, QUOTE_MAX, questionsIn, quoteOf, quotesIn, quoteSegments, removeQuote, tappedAnswer } from '../app/utils/questionReply'

const asked = (text: string) => questionsIn(text).map(q => q.text)

describe('questionsIn', () => {
  it('finds the question that ends a block', () => {
    expect(asked('Shall I push?')).toEqual(['Shall I push?'])
    expect(asked('The build is green. Shall I push? Or wait for review?')).toEqual(['Shall I push? Or wait for review?'])
    expect(asked('Done. Nothing else to do.')).toEqual([])
    expect(asked('?')).toEqual([])
  })
  it('finds a question followed by other sentences', () => {
    expect(asked('I added the task to the queue, to be confirmed. Shall I start step 1 now? A slot is free on the server.'))
      .toEqual(['Shall I start step 1 now?'])
    expect(asked('J’ai noté la tâche dans « En file », à valider. Je lance l’étape 1 maintenant ? Une place est libre sur le serveur.'))
      .toEqual(['Je lance l’étape 1 maintenant ?'])
    expect(asked('Can you plug the box in over **Ethernet**? Over Wi-Fi the copy would take 30 hours.'))
      .toEqual(['Can you plug the box in over **Ethernet**?'])
    expect(asked('Use A? Or B? Both work. Your call.')).toEqual(['Use A? Or B?'])
  })
  it('returns one question per group of consecutive question sentences, in order', () => {
    expect(asked('Shall I push now? The build is green. Or do you want a review first? Both are fine. Your call.'))
      .toEqual(['Shall I push now?', 'Or do you want a review first?'])
    expect(asked('Je pousse maintenant ? Le build est vert. Tu préfères relire avant ? Ou attendre demain ? Les deux me vont.'))
      .toEqual(['Je pousse maintenant ?', 'Tu préfères relire avant ? Ou attendre demain ?'])
  })
  it('says where each question sits in the block', () => {
    const text = 'Done.  Shall I\npush?  The build is green.'
    const [q] = questionsIn(text)
    expect(q).toEqual({ text: 'Shall I push?', start: 7, end: 20 })
    expect(text.slice(q!.start, q!.end)).toBe('Shall I\npush?')
  })
  it('joins a question written over several lines', () => {
    expect(asked('Can you plug the box in\nover Ethernet, so the copy\ngoes faster?')).toEqual(['Can you plug the box in over Ethernet, so the copy goes faster?'])
  })
  it('understands French spacing and closing marks', () => {
    expect(asked('Tu peux brancher la box en Ethernet… ?')).toEqual(['Tu peux brancher la box en Ethernet… ?'])
    expect(asked('J’ai fini. On garde « la seconde » ?')).toEqual(['On garde « la seconde » ?'])
    expect(asked('J’ai fini. On garde « la seconde » ? Elle est plus courte.')).toEqual(['On garde « la seconde » ?'])
    expect(asked('Use **v1.2** or the *new* one?**')).toEqual(['Use **v1.2** or the *new* one?**'])
    expect(asked('(should I also update the docs?)')).toEqual(['(should I also update the docs?)'])
  })
  it('does not cut on decimals, versions or abbreviations', () => {
    expect(asked('Bump to 2.5 now?')).toEqual(['Bump to 2.5 now?'])
    expect(asked('Bump to 2.5 now? The 2.4 line is frozen.')).toEqual(['Bump to 2.5 now?'])
    expect(asked('Shall I drop the old files, e.g. the logs? They take 2 GB.')).toEqual(['Shall I drop the old files, e.g. the logs?'])
  })
  it('ignores a "?" inside a URL', () => {
    expect(asked('The page is at https://example.com/search?x=1 and it loads. I checked it twice.')).toEqual([])
    expect(asked('Add ?x=1 to the address. Then reload the page.')).toEqual([])
    expect(asked('La page est sur https://example.com/recherche?x=1&y=2 et elle répond. Je l’ai vérifiée.')).toEqual([])
    expect(asked('Is https://example.com/search?x=1 the right page? It answers 200.')).toEqual(['Is https://example.com/search?x=1 the right page?'])
  })
  it('ignores a question quoted inside a statement', () => {
    expect(asked('You asked "can it be faster?" earlier. I made it twice as fast.')).toEqual([])
    expect(asked('You asked: "Can it be faster?" I made it twice as fast.')).toEqual([])
    expect(asked('Tu as demandé « on peut aller plus vite ? » hier. C’est fait.')).toEqual([])
    expect(asked('Tu as écrit : « On peut aller plus vite ? » C’est fait, deux fois plus rapide.')).toEqual([])
    expect(asked('The button says "Reply?"')).toEqual([])
  })
  it('ignores a question the block answers itself', () => {
    expect(asked('Is it done? Yes, it is.')).toEqual([])
    expect(asked('Why? Because the cache is stale.')).toEqual([])
    expect(asked('Does it break the API? No. The route keeps its shape.')).toEqual([])
    expect(asked('Est-ce que ça casse l’API ? Non, la route garde sa forme.')).toEqual([])
    expect(asked('Pourquoi ? Le cache n’est jamais vidé.')).toEqual([])
    expect(asked('Résultat ? Rien ne change pour toi.')).toEqual([])
    // A statement that merely starts like an answer word is not one.
    expect(asked('Shall I push? Nothing else is pending.')).toEqual(['Shall I push?'])
    expect(asked('Je pousse ? Sinon j’attends demain.')).toEqual(['Je pousse ?'])
  })
})

describe('quoting in the draft', () => {
  it('stacks quotes in order, each followed by its answer', () => {
    let draft = addQuote('', 'Can you plug the box in over Ethernet?')!
    expect(draft).toBe('> Can you plug the box in over Ethernet?\n')
    draft += 'No, not for now.'
    draft = addQuote(draft, 'Shall I send the request to the coordinator?')!
    draft += 'Yes.'
    expect(draft).toBe('> Can you plug the box in over Ethernet?\nNo, not for now.\n> Shall I send the request to the coordinator?\nYes.')
    expect(quotesIn(draft).map(q => q.text)).toEqual(['Can you plug the box in over Ethernet?', 'Shall I send the request to the coordinator?'])
  })
  it('never quotes the same question twice', () => {
    const draft = addQuote('Hi\n', 'Shall I push?')!
    expect(isQuoted(draft, 'Shall I push?')).toBe(true)
    expect(isQuoted(draft, '  shall i   push? ')).toBe(true)
    expect(isQuoted(draft, 'Shall I merge?')).toBe(false)
    expect(addQuote(draft, 'Shall I push?')).toBeNull()
  })
  it('keeps two unanswered quotes apart', () => {
    const draft = addQuote(addQuote('', 'First?')!, 'Second?')!
    expect(draft).toBe('> First?\n\n> Second?\n')
    expect(quotesIn(draft).map(q => q.text)).toEqual(['First?', 'Second?'])
  })
  it('quotes a multi-line passage line by line, a very long one by its start and end', () => {
    expect(quoteOf('First line\n\n  second line  \n')).toBe('> First line\n> second line')
    const long = `${'word '.repeat(150)}end.`
    const q = quoteOf(long)
    expect(q.startsWith('> word')).toBe(true)
    expect(q.endsWith('end.')).toBe(true)
    expect(q.length).toBeLessThanOrEqual(QUOTE_MAX + 2)
    expect(q).toContain('…')
  })
  it('removes one quote and keeps the answers', () => {
    const draft = '> First?\nYes.\n> Second?\nNo.'
    const [first, second] = quotesIn(draft)
    expect(removeQuote(draft, first!)).toBe('Yes.\n> Second?\nNo.')
    expect(removeQuote(draft, second!)).toBe('> First?\nYes.\nNo.')
    expect(removeQuote('> Only?\n', quotesIn('> Only?\n')[0]!)).toBe('')
  })
})

describe('quoteSegments', () => {
  it('splits a sent message into quotes and answers', () => {
    expect(quoteSegments('> First?\nYes.\n> Second?\n> still second\nNo.')).toEqual([
      { quote: true, text: 'First?' },
      { quote: false, text: 'Yes.' },
      { quote: true, text: 'Second?\nstill second' },
      { quote: false, text: 'No.' },
    ])
    expect(quoteSegments('Plain message')).toEqual([{ quote: false, text: 'Plain message' }])
  })

  it('keeps a line starting with ">" but no space as the user\'s text', () => {
    const text = 'Reply between the markers.\n<<<\nBody\n>>>'
    expect(quoteSegments(text)).toEqual([{ quote: false, text }])
    expect(quoteSegments('>= 5 items\n>file.txt\n>>nested')).toEqual([{ quote: false, text: '>= 5 items\n>file.txt\n>>nested' }])
    expect(quotesIn('>>>\n> Real?\n>>>')).toEqual([{ text: 'Real?', start: 4, end: 12 }])
    expect(addQuote('done\n>>>', 'Next?')).toBe('done\n>>>\n> Next?\n')
  })
})

describe('isClosedQuestion', () => {
  it('accepts a question that yes or no answers in full', () => {
    for (const q of [
      'Shall I start step 1 now?',
      'Should I merge the branch?',
      'Can you plug the box in over **Ethernet**?',
      'Do you want a review first?',
      'Is the build green?',
      'Are you ready?',
      'And so, shall I push?',
      'Last point: shall I publish the release notes?',
      'Shall I use this title: Release 2?',
      'Want me to open the pull request?',
      'OK to merge?',
      'I merge it tonight, OK?',
      'Je lance l’étape 1 maintenant ?',
      'Dernier point : je publie les notes de version ?',
      'On garde « la seconde » ?',
      'Tu peux brancher la box en Ethernet… ?',
      'Est-ce que je fusionne la branche ?',
      'Dois-je relancer les tests ?',
      'Veux-tu une revue avant ?',
      'Et donc, j’envoie la demande au coordinateur ?',
      'C’est bon pour toi ?',
      'D’accord pour fusionner ce soir ?',
      'Je fusionne ce soir, d’accord ?',
    ]) expect(isClosedQuestion(q), q).toBe(true)
  })
  it('leaves an open question to Reply alone', () => {
    for (const q of [
      'What is left?',
      'Which branch shall I use?',
      'How do you want it?',
      'Where are the threads?',
      'Anything to note?',
      'Et en français ?',
      'Quel nom pour la branche ?',
      'On fait quoi ?',
      'Je lance laquelle ?',
      'On déploie quand ?',
      'Je préviens qui ?',
      'Tu veux que je range ça où ?',
      'Comment je nomme le fichier ?',
    ]) expect(isClosedQuestion(q), q).toBe(false)
  })
  it('refuses, in doubt, what a single yes would not settle', () => {
    for (const q of [
      // An alternative.
      'Shall I push or wait?',
      'Or do you want a review first?',
      'Je pousse ou j’attends ?',
      // Two questions in one reply target.
      'Shall I push? Or wait for review?',
      'Tu préfères relire avant ? Ou attendre demain ?',
      // A negation: "yes" could mean either.
      'Shouldn’t I wait for the review?',
      'Do you not want the old one?',
      'Tu ne veux pas relire avant ?',
      'On n’attend pas la revue ?',
      // An interrogative word inside a yes/no shape.
      'Do you know why it fails?',
      'Can you tell me which one?',
      // A condition before the question, a noun phrase, an English "on".
      'If the tests pass, shall I merge?',
      'The second one?',
      'On the main branch?',
      // Not a question.
      'Shall I push.',
      'You asked "shall I push?"',
    ]) expect(isClosedQuestion(q), q).toBe(false)
  })
})

describe('one-tap answers', () => {
  const Q1 = 'Shall I start step 1 now?'
  const Q2 = 'Je publie les notes de version ?'
  it('quotes the question and writes the answer under it', () => {
    expect(addAnswer('', Q1, 'Yes')).toBe(`> ${Q1}\nYes\n`)
    expect(addAnswer('Hello.', Q1, 'No')).toBe(`Hello.\n> ${Q1}\nNo\n`)
  })
  it('answers several questions one after the other', () => {
    const one = addAnswer('', Q1, 'Yes')!
    const two = addAnswer(one, Q2, 'Non')!
    expect(two).toBe(`> ${Q1}\nYes\n> ${Q2}\nNon\n`)
    expect(answerOf(two, Q1)).toBe('Yes')
    expect(answerOf(two, Q2)).toBe('Non')
    // A plain quote can still follow.
    expect(addQuote(two, 'Anything else?')).toBe(`${two}> Anything else?\n`)
  })
  it('answers a question already quoted, wherever it is in the draft', () => {
    const draft = `> ${Q1}\n\n> ${Q2}\n`
    expect(answerOf(draft, Q1)).toBe('')
    expect(addAnswer(draft, Q1, 'Yes')).toBe(`> ${Q1}\nYes\n> ${Q2}\n`)
    expect(addAnswer(draft, Q2, 'No')).toBe(`> ${Q1}\n\n> ${Q2}\nNo\n`)
    expect(addAnswer(`> ${Q1}`, Q1, 'Yes')).toBe(`> ${Q1}\nYes\n`)
  })
  it('replaces the answer of an earlier tap, in either language', () => {
    const draft = `> ${Q1}\nYes\n> ${Q2}\nOui\n`
    expect(addAnswer(draft, Q1, 'No')).toBe(`> ${Q1}\nNo\n> ${Q2}\nOui\n`)
    expect(addAnswer(draft, Q2, 'Non')).toBe(`> ${Q1}\nYes\n> ${Q2}\nNon\n`)
    expect(addAnswer(draft, Q1, 'Yes')).toBeNull()
  })
  it('never overwrites what the user wrote', () => {
    const draft = `> ${Q1}\nYes, but after lunch.\n`
    expect(addAnswer(draft, Q1, 'No')).toBeNull()
    expect(answerOf(draft, Q1)).toBe('Yes, but after lunch.')
  })
  it('reads which answer a tap wrote', () => {
    expect(['Yes', 'oui', 'OUI.', ' yes '].map(tappedAnswer)).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(['No', 'non', 'Non.'].map(tappedAnswer)).toEqual(['no', 'no', 'no'])
    expect(['', 'Yes please', 'nope', 'ok'].map(tappedAnswer)).toEqual([null, null, null, null])
    expect(answerOf('Hello', Q1)).toBeNull()
  })
})

describe('decisionRows', () => {
  const rows = [['1', 'Tag the release today?', 'Yes'], ['2', 'Keep the old export format?', 'No'], ['3', 'Publish the notes?', 'Yes']]
  it('reads the numbered questions of a decision table', () => {
    expect(decisionRows(['#', 'Question', 'My advice'], rows)).toEqual([
      { n: '1', text: 'Tag the release today?' },
      { n: '2', text: 'Keep the old export format?' },
      { n: '3', text: 'Publish the notes?' },
    ])
  })
  it('finds the number column wherever it is, in its usual spellings', () => {
    expect(decisionRows(['Décision', 'Avis', 'N°'], [['Fusionner ce soir', 'Oui', '1.'], ['Publier la 1.4', 'Non', '2.']]))
      .toEqual([{ n: '1', text: 'Fusionner ce soir' }, { n: '2', text: 'Publier la 1.4' }])
    expect(decisionRows(['ID', 'Question'], [['Q1', 'Merge now?'], ['Q2', 'Tag it?']])).toEqual([{ n: 'Q1', text: 'Merge now?' }, { n: 'Q2', text: 'Tag it?' }])
    for (const head of ['#', 'N°', 'Nº', 'No', 'no.', 'Num', 'Numéro', 'Q', 'id'])
      expect(decisionRows([head, 'Question'], [['1', 'Merge now?']]), head).toEqual([{ n: '1', text: 'Merge now?' }])
  })
  it('names the question column by its header, by its question marks, or by the advice next to it', () => {
    // Header.
    expect(decisionRows(['#', 'Choix', 'Détail'], [['1', 'Thème par défaut', 'Titanium']])).toEqual([{ n: '1', text: 'Thème par défaut' }])
    // Every cell asks.
    expect(decisionRows(['#', 'Sujet', 'Contexte'], [['1', 'On fusionne ?', 'CI verte'], ['2', 'On publie ?', 'npm prêt']]))
      .toEqual([{ n: '1', text: 'On fusionne ?' }, { n: '2', text: 'On publie ?' }])
    // An advice column: the first column left is the question.
    expect(decisionRows(['#', 'Sujet', 'Mon avis'], [['1', 'Fusionner t-0001', 'Oui'], ['2', 'Publier', 'Non']]))
      .toEqual([{ n: '1', text: 'Fusionner t-0001' }, { n: '2', text: 'Publier' }])
    expect(decisionRows(['#', 'Recommendation', 'Topic'], [['1', 'Yes', 'Merge the branch']])).toEqual([{ n: '1', text: 'Merge the branch' }])
  })
  it('ignores a table that is not a list of numbered questions', () => {
    // Numbered, but nothing says its rows are questions.
    expect(decisionRows(['#', 'File', 'Size'], [['1', 'main.css', '120 kB'], ['2', 'app.js', '300 kB']])).toBeNull()
    // Questions, but no number column.
    expect(decisionRows(['Question', 'Avis'], [['Merge now?', 'Yes']])).toBeNull()
    // The "#" column does not number: text, a repeated number, a long one.
    expect(decisionRows(['#', 'Question'], [['a', 'Merge now?']])).toBeNull()
    expect(decisionRows(['#', 'Question'], [['1', 'Merge now?'], ['1', 'Tag it?']])).toBeNull()
    expect(decisionRows(['#', 'Question'], [['1234', 'Merge now?']])).toBeNull()
    expect(decisionRows(['Count', 'Question'], [['1', 'Merge now?']])).toBeNull()
    // Only some cells ask, and no header or advice says more.
    expect(decisionRows(['#', 'Step', 'State'], [['1', 'Merge now?', 'open'], ['2', 'Tagged', 'done']])).toBeNull()
    // An empty question, a short row, no row, a single column.
    expect(decisionRows(['#', 'Question'], [['1', '']])).toBeNull()
    expect(decisionRows(['#', 'Question', 'Avis'], [['1', 'Merge now?']])).toBeNull()
    expect(decisionRows(['#', 'Question'], [])).toBeNull()
    expect(decisionRows(['#'], [['1']])).toBeNull()
  })
})

describe('answers to a decision table', () => {
  it('writes one line per row, by its number', () => {
    const one = setRowAnswer('', '1', '1: yes')!
    expect(one).toBe('1: yes\n')
    const two = setRowAnswer(one, '3', '3 : non')!
    expect(two).toBe('1: yes\n3 : non\n')
    expect([rowAnswer(two, '1'), rowAnswer(two, '2'), rowAnswer(two, '3')]).toEqual(['yes', null, 'non'])
    // "1" is not "10", and a quoted line is not an answer.
    expect(rowAnswer('10: yes\n> 1: yes\n', '1')).toBeNull()
  })
  it('replaces the line of an earlier tap in place, never the user\'s own words', () => {
    const draft = '1: yes\n2 : oui\n3: later, after the review\n'
    expect(setRowAnswer(draft, '1', '1: no')).toBe('1: no\n2 : oui\n3: later, after the review\n')
    expect(setRowAnswer(draft, '2', '2 : non')).toBe('1: yes\n2 : non\n3: later, after the review\n')
    expect(setRowAnswer(draft, '1', '1: yes')).toBeNull()
    expect(setRowAnswer(draft, '3', '3: no')).toBeNull()
    // A line the user started ("4:") takes the answer.
    expect(setRowAnswer('4:', '4', '4: yes')).toBe('4: yes')
  })
  it('never glues a line to an unanswered quote', () => {
    expect(setRowAnswer('> Shall I push?\n', '1', '1: yes')).toBe('> Shall I push?\n\n1: yes\n')
    expect(setRowAnswer('> Shall I push?\nYes\n', '1', '1: yes')).toBe('> Shall I push?\nYes\n1: yes\n')
  })
  it('accepts the whole table, and takes it back on a second tap', () => {
    expect(toggleOkAll('', 'ok to all')).toBe('ok to all\n')
    expect(toggleOkAll('2: no\n', 'ok tout')).toBe('2: no\nok tout\n')
    expect(hasOkAll('2: no\nok tout\n')).toBe(true)
    expect(hasOkAll('OK to all.')).toBe(true)
    expect(hasOkAll('> ok to all\n')).toBe(false)
    expect(hasOkAll('ok to all of them but 2')).toBe(false)
    expect(toggleOkAll('2: no\nok tout\n', 'ok tout')).toBe('2: no\n')
    expect(toggleOkAll('ok to all\n3: no\n', 'ok to all')).toBe('3: no\n')
  })
  it('quotes a row with its number, and knows when a row is settled', () => {
    const row = { n: '2', text: 'Keep the old export format?' }
    expect(rowQuote(row)).toBe('2. Keep the old export format?')
    expect(rowSettled('', row)).toBe(false)
    expect(rowSettled('1: yes\n', row)).toBe(false)
    expect(rowSettled('2: no\n', row)).toBe(true)
    expect(rowSettled(addQuote('', rowQuote(row))!, row)).toBe(true)
    expect(rowSettled('ok to all\n', row)).toBe(true)
  })
})

describe('unansweredCount', () => {
  const q = (text: string, n = '1') => ({ n, text, closed: false })
  const two = { questions: [q('Shall I push now?'), q('Which name do you prefer?', '2')], rows: [] }
  it('counts the questions the draft does not quote yet', () => {
    expect(unansweredCount(two, '')).toBe(2)
    // Words of the user's do not say which of two questions they answer.
    expect(unansweredCount(two, 'Yes, go ahead.')).toBe(2)
    const one = addAnswer('', 'Shall I push now?', 'Yes')!
    expect(unansweredCount(two, one)).toBe(1)
    expect(unansweredCount(two, addQuote(one, 'Which name do you prefer?')!)).toBe(0)
  })
  it('takes any words as the answer when the reply asks one thing only', () => {
    const single = { questions: [q('Shall I push now?')], rows: [] }
    expect(unansweredCount(single, '')).toBe(1)
    expect(unansweredCount(single, '  \n')).toBe(1)
    expect(unansweredCount(single, 'Go ahead.')).toBe(0)
    expect(unansweredCount(single, '> Shall I push now?\n')).toBe(0)
    // A quote of something else is not an answer.
    expect(unansweredCount(single, '> The build is green.\n')).toBe(1)
  })
  it('counts the rows of a decision table until they are settled', () => {
    const rows = [{ n: '1', text: 'Tag the release?' }, { n: '2', text: 'Keep the old format?' }, { n: '3', text: 'Publish the notes?' }]
    const table = { questions: [q('Shall I start the next thread?')], rows }
    expect(unansweredCount(table, '')).toBe(4)
    expect(unansweredCount(table, '1: yes\n')).toBe(3)
    expect(unansweredCount(table, `1: yes\n> ${rowQuote(rows[1]!)}\n`)).toBe(2)
    // "ok to all" settles the table, not the question next to it.
    expect(unansweredCount(table, 'ok to all\n')).toBe(1)
    expect(unansweredCount(table, addAnswer('ok to all\n', 'Shall I start the next thread?', 'Yes')!)).toBe(0)
    expect(unansweredCount({ questions: [], rows: [] }, '')).toBe(0)
  })
})
