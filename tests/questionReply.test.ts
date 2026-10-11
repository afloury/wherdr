import { describe, expect, it } from 'vitest'
import { addAnswer, addQuote, answerOf, decisionRows, isClosedQuestion, isOpenQuestion, rowNumbers, rowRef, rowSettled, tableOf, tableRef, toggleOkAll, unansweredCount, isQuoted, questionsIn, quotesIn, removeQuote, tappedAnswer } from '../app/utils/questionReply'
import { messageRef, parseRef, pointRef, refLine } from '../shared/reference'

// A question or a point of the message of 11:37, as its button refers to it.
const T = '11:37'
const pt = (text: string) => pointRef(text, T)
const line = (text: string) => `↳ Quote point ${T} : ${text} —`

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
  it('stacks references in order, each followed by its answer', () => {
    let draft = addQuote('', pt('Can you plug the box in over Ethernet?'))!
    expect(draft).toBe(`${line('Can you plug the box in over Ethernet?')}\n`)
    draft += 'No, not for now.'
    draft = addQuote(draft, pt('Shall I send the request to the coordinator?'))!
    draft += 'Yes.'
    expect(draft).toBe(`${line('Can you plug the box in over Ethernet?')}\nNo, not for now.\n${line('Shall I send the request to the coordinator?')}\nYes.`)
    expect(quotesIn(draft).map(q => q.excerpt)).toEqual(['Can you plug the box in over Ethernet?', 'Shall I send the request to the coordinator?'])
  })
  it('never quotes the same question twice', () => {
    const draft = addQuote('Hi\n', pt('Shall I push?'))!
    expect(isQuoted(draft, pt('Shall I push?'))).toBe(true)
    expect(isQuoted(draft, pt('  shall i   push? '))).toBe(true)
    expect(isQuoted(draft, pt('Shall I merge?'))).toBe(false)
    expect(addQuote(draft, pt('Shall I push?'))).toBeNull()
  })
  it('tells the same words of two messages apart', () => {
    const draft = addQuote('', pt('Shall I push?'))!
    expect(isQuoted(draft, pointRef('Shall I push?', '09:02'))).toBe(false)
    expect(addQuote(draft, pointRef('Shall I push?', '09:02'))).toBe(`${line('Shall I push?')}\n\n↳ Quote point 09:02 : Shall I push? —\n`)
  })
  it('keeps two unanswered references apart', () => {
    const draft = addQuote(addQuote('', pt('First?'))!, pt('Second?'))!
    expect(draft).toBe(`${line('First?')}\n\n${line('Second?')}\n`)
    expect(quotesIn(draft).map(q => q.excerpt)).toEqual(['First?', 'Second?'])
  })
  it('refers to a whole message the same way', () => {
    const draft = addQuote('Hello.', messageRef('I can merge the PR.', T))!
    expect(draft).toBe('Hello.\n↳ Quote message 11:37 : I can merge the PR. —\n')
    expect(addQuote(draft, messageRef('I can merge the PR.', T))).toBeNull()
  })
  it('removes one reference and keeps the answers', () => {
    const draft = `${line('First?')}\nYes.\n${line('Second?')}\nNo.`
    const [first, second] = quotesIn(draft)
    expect(removeQuote(draft, first!)).toBe(`Yes.\n${line('Second?')}\nNo.`)
    expect(removeQuote(draft, second!)).toBe(`${line('First?')}\nYes.\nNo.`)
    expect(removeQuote(`${line('Only?')}\n`, quotesIn(`${line('Only?')}\n`)[0]!)).toBe('')
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

describe('isOpenQuestion', () => {
  it('tells the questions that ask for words', () => {
    expect(['Which name for the theme?', 'Merge or wait?', 'On déploie quand ?', 'Quel thème par défaut ?'].map(isOpenQuestion)).toEqual([true, true, true, true])
    // Terse rows of a decision table, and what is not a question.
    expect(['Merge now?', 'Keep the old export format?', 'Fusionner ce soir', 'Publier la 1.4 ?'].map(isOpenQuestion)).toEqual([false, false, false, false])
  })
})

describe('one-tap answers', () => {
  const Q1 = 'Shall I start step 1 now?'
  const Q2 = 'Je publie les notes de version ?'
  it('refers to the question and writes the answer under it', () => {
    expect(addAnswer('', pt(Q1), 'Yes')).toBe(`${line(Q1)}\nYes\n`)
    expect(addAnswer('Hello.', pt(Q1), 'No')).toBe(`Hello.\n${line(Q1)}\nNo\n`)
  })
  it('answers several questions one after the other', () => {
    const one = addAnswer('', pt(Q1), 'Yes')!
    const two = addAnswer(one, pt(Q2), 'Non')!
    expect(two).toBe(`${line(Q1)}\nYes\n${line(Q2)}\nNon\n`)
    expect(answerOf(two, pt(Q1))).toBe('Yes')
    expect(answerOf(two, pt(Q2))).toBe('Non')
    // A plain quote can still follow.
    expect(addQuote(two, pt('Anything else?'))).toBe(`${two}${line('Anything else?')}\n`)
  })
  it('answers a question already quoted, wherever it is in the draft', () => {
    const draft = `${line(Q1)}\n\n${line(Q2)}\n`
    expect(answerOf(draft, pt(Q1))).toBe('')
    expect(addAnswer(draft, pt(Q1), 'Yes')).toBe(`${line(Q1)}\nYes\n${line(Q2)}\n`)
    expect(addAnswer(draft, pt(Q2), 'No')).toBe(`${line(Q1)}\n\n${line(Q2)}\nNo\n`)
    expect(addAnswer(line(Q1), pt(Q1), 'Yes')).toBe(`${line(Q1)}\nYes\n`)
  })
  it('replaces the answer of an earlier tap, in either language', () => {
    const draft = `${line(Q1)}\nYes\n${line(Q2)}\nOui\n`
    expect(addAnswer(draft, pt(Q1), 'No')).toBe(`${line(Q1)}\nNo\n${line(Q2)}\nOui\n`)
    expect(addAnswer(draft, pt(Q2), 'Non')).toBe(`${line(Q1)}\nYes\n${line(Q2)}\nNon\n`)
    expect(addAnswer(draft, pt(Q1), 'Yes')).toBeNull()
  })
  it('never overwrites what the user wrote', () => {
    const draft = `${line(Q1)}\nYes, but after lunch.\n`
    expect(addAnswer(draft, pt(Q1), 'No')).toBeNull()
    expect(answerOf(draft, pt(Q1))).toBe('Yes, but after lunch.')
  })
  it('reads which answer a tap wrote', () => {
    expect(['Yes', 'oui', 'OUI.', ' yes '].map(tappedAnswer)).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(['No', 'non', 'Non.'].map(tappedAnswer)).toEqual(['no', 'no', 'no'])
    expect(['', 'Yes please', 'nope', 'ok'].map(tappedAnswer)).toEqual([null, null, null, null])
    expect(answerOf('Hello', pt(Q1))).toBeNull()
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
  const rows = [{ n: '1', text: 'Tag the release?' }, { n: '2', text: 'Keep the old format?' }, { n: '3', text: 'Publish the notes?' }]
  const all = tableOf(rows)
  const table = rows.map(r => ({ ...r, all }))
  const row = (n: number) => rowRef(table[n - 1]!, T)
  const ALL = '↳ Quote decisions 11:37 #1-3 : Tag the release? · Keep the old format? · Publish the notes? —'
  expect(ALL).toBe(refLine(tableRef(all, T)))
  it('names the message and the row in every answer', () => {
    const one = addAnswer('', row(1), 'Yes')!
    expect(one).toBe('↳ Quote decision 11:37 #1 : Tag the release? —\nYes\n')
    const two = addAnswer(one, row(3), 'Non')!
    expect(two).toBe('↳ Quote decision 11:37 #1 : Tag the release? —\nYes\n↳ Quote decision 11:37 #3 : Publish the notes? —\nNon\n')
    expect([1, 2, 3].map(n => answerOf(two, row(n)))).toEqual(['Yes', null, 'Non'])
  })
  it('never takes the row of another message for this one', () => {
    const earlier = addAnswer('', rowRef(table[0]!, '09:02'), 'Yes')!
    expect(answerOf(earlier, row(1))).toBeNull()
    expect(rowSettled(earlier, table[0]!, T)).toBe(false)
    expect(rowSettled(earlier, table[0]!, '09:02')).toBe(true)
  })
  it('replaces the answer of an earlier tap in place, never the user\'s own words', () => {
    const draft = addAnswer(addAnswer('', row(1), 'Yes')!, row(2), 'Oui')! + '↳ Quote decision 11:37 #3 : Publish the notes? —\nLater, after the review\n'
    expect(answerOf(addAnswer(draft, row(1), 'No')!, row(1))).toBe('No')
    expect(answerOf(addAnswer(draft, row(2), 'Non')!, row(2))).toBe('Non')
    expect(addAnswer(draft, row(1), 'Yes')).toBeNull()
    expect(addAnswer(draft, row(3), 'No')).toBeNull()
  })
  it('accepts the whole table, and takes it back on a second tap', () => {
    const ref = tableRef(all, T)
    expect(toggleOkAll('', ref, 'OK to all')).toBe(`${ALL}\nOK to all\n`)
    const withNo = addAnswer('', row(2), 'No')!
    const both = toggleOkAll(withNo, ref, 'OK tout')
    expect(both).toBe(`${withNo}${ALL}\nOK tout\n`)
    expect(isQuoted(both, ref)).toBe(true)
    expect(toggleOkAll(both, ref, 'OK tout')).toBe(withNo)
    // An exception written after it stays.
    const exception = addAnswer(toggleOkAll('', ref, 'OK to all'), row(3), 'No')!
    expect(toggleOkAll(exception, ref, 'OK to all')).toBe('↳ Quote decision 11:37 #3 : Publish the notes? —\nNo\n')
    // Words the user wrote under it are kept.
    expect(toggleOkAll(`${ALL}\nOK, except the last one\n`, ref, 'OK to all')).toBe('OK, except the last one\n')
  })
  it('knows when a row is settled: answered, quoted, or its table accepted', () => {
    expect(rowSettled('', table[1]!, T)).toBe(false)
    expect(rowSettled(addAnswer('', row(1), 'Yes')!, table[1]!, T)).toBe(false)
    expect(rowSettled(addAnswer('', row(2), 'No')!, table[1]!, T)).toBe(true)
    expect(rowSettled(addQuote('', row(2))!, table[1]!, T)).toBe(true)
    expect(rowSettled(`${ALL}\nOK to all\n`, table[1]!, T)).toBe(true)
    // The table of another message does not settle this one.
    expect(rowSettled(toggleOkAll('', tableRef(all, '09:02'), 'OK to all'), table[1]!, T)).toBe(false)
  })
})

describe('unansweredCount', () => {
  const q = (text: string, n = '1') => ({ n, text, closed: false })
  const two = { questions: [q('Shall I push now?'), q('Which name do you prefer?', '2')], rows: [] }
  it('counts the questions the draft does not quote yet', () => {
    expect(unansweredCount(two, '', T)).toBe(2)
    // Words of the user's do not say which of two questions they answer.
    expect(unansweredCount(two, 'Yes, go ahead.', T)).toBe(2)
    const one = addAnswer('', pt('Shall I push now?'), 'Yes')!
    expect(unansweredCount(two, one, T)).toBe(1)
    expect(unansweredCount(two, addQuote(one, pt('Which name do you prefer?'))!, T)).toBe(0)
  })
  it('takes any words as the answer when the reply asks one thing only', () => {
    const single = { questions: [q('Shall I push now?')], rows: [] }
    expect(unansweredCount(single, '', T)).toBe(1)
    expect(unansweredCount(single, '  \n', T)).toBe(1)
    expect(unansweredCount(single, 'Go ahead.', T)).toBe(0)
    expect(unansweredCount(single, `${line('Shall I push now?')}\n`, T)).toBe(0)
    // A quote of something else is not an answer.
    expect(unansweredCount(single, `${line('The build is green.')}\n`, T)).toBe(1)
  })
  it('counts the rows of a decision table until they are settled', () => {
    const rows = [{ n: '1', text: 'Tag the release?' }, { n: '2', text: 'Keep the old format?' }, { n: '3', text: 'Publish the notes?' }]
    const all = tableOf(rows)
    const table = { questions: [q('Shall I start the next thread?')], rows: rows.map(r => ({ ...r, all })) }
    expect(unansweredCount(table, '', T)).toBe(4)
    const one = addAnswer('', rowRef(rows[0]!, T), 'Yes')!
    expect(unansweredCount(table, one, T)).toBe(3)
    expect(unansweredCount(table, addQuote(one, rowRef(rows[1]!, T))!, T)).toBe(2)
    // "OK to all" settles the table, not the question next to it.
    const ok = toggleOkAll('', tableRef(all, T), 'OK to all')
    expect(unansweredCount(table, ok, T)).toBe(1)
    expect(unansweredCount(table, addAnswer(ok, pt('Shall I start the next thread?'), 'Yes')!, T)).toBe(0)
    expect(unansweredCount({ questions: [], rows: [] }, '', T)).toBe(0)
  })
})

describe('row numbers of a whole table', () => {
  it('names only the rows actually present', () => {
    const rows = decisionRows(['#', 'Question'], [['1', 'Keep staging?'], ['4', 'Delete production?']])!
    expect(rows).toHaveLength(2)
    expect(refLine(tableRef(tableOf(rows), '11:37'))).toBe('↳ Quote decisions 11:37 #1,4 : Keep staging? · Delete production? —')
  })
  it('writes a run of consecutive numbers as a range', () => {
    expect(rowNumbers(['1', '2', '3', '4'])).toBe('1-4')
    expect(rowNumbers(['1', '2'])).toBe('1-2')
    expect(rowNumbers(['1', '2', '4'])).toBe('1-2,4')
    expect(rowNumbers(['2', '4', '5', '6', '9'])).toBe('2,4-6,9')
    expect(rowNumbers(['Q1', 'Q2', 'Q3'])).toBe('Q1-Q3')
    expect(rowNumbers(['Q1', 'D2'])).toBe('Q1,D2')
    expect(rowNumbers(['3', '2', '1'])).toBe('3,2,1')
    expect(rowNumbers(['7'])).toBe('7')
  })
  it('is read back as the rows of the reference', () => {
    expect(parseRef('↳ Quote decisions 11:37 #1-2,4 : Keep staging? —')).toMatchObject({ kind: 'decisions', n: '1-2,4' })
  })
})
