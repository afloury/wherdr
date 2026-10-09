import { describe, expect, it } from 'vitest'
import { boardSections, visibleSections, maxParallelThreads, moveMessage, queueStatus, missingLists as missingListsOf, coordinatorRules, decisionPrefix, reviewCommentPrefix, reviewedMessage, detailPrefix, launchMessage, listKind, normalizeThreads, parseTaskLine, parseTasks, takeBadges, badgeColor, badgeTarget, textParts, prefillDraft, problemPrefix, questionPrefix, splitThreads, testedMessage, unblockMessage } from '../shared/projectBoard'
import { pluginBinary } from '../server/utils/projectBoard'
import { isCoordinator } from '../shared/projects'
import type { Pane } from '../shared/types'

const TASKS = `# Tasks

Quelques mots d'intro hors liste.
- [ ] ignorée : avant toute liste (me)

## À tester
- [ ] Réglages › Agents : décocher Kimi (me)
- [x] Étoile animée (me)

## À décider
- [ ] Regroupement par projet : ok tel quel ? (me)

## En cours
- [ ] Panneau « Projet » à côté du coordinateur (agent → t-0034)
- [ ] Masquer les quotas (agent -> t-0033)
  - détail indenté, ignoré
- [ ] Revue du design (Alice)

## Idées en vrac
* Une idée sans case (agent)
- [ ] Parenthèses (au milieu) du titre

\`\`\`
## Pas une liste
- [ ] pas une tâche
\`\`\`

## Backlog
- [ ] Release : dépôt neuf \`wherdr\` en 1 commit
`

describe('TASKS.md', () => {
  it('reads all lists in their order, known names recognized', () => {
    const lists = parseTasks(TASKS)
    expect(lists.map(l => [l.title, l.kind])).toEqual([
      ['À tester', 'test'],
      ['À décider', 'decide'],
      ['En cours', 'doing'],
      ['Idées en vrac', null],
      ['Backlog', 'backlog'],
    ])
    expect(lists[0]!.tasks).toEqual([
      { text: 'Réglages › Agents : décocher Kimi', done: false, owner: 'me', thread: null },
      { text: 'Étoile animée', done: true, owner: 'me', thread: null },
    ])
  })

  it('recognizes owners, including a thread', () => {
    const doing = parseTasks(TASKS)[2]!.tasks
    expect(doing.map(t => [t.owner, t.thread])).toEqual([
      ['agent → t-0034', 't-0034'],
      ['agent -> t-0033', 't-0033'],
      ['Alice', null],
    ])
    const ideas = parseTasks(TASKS)[3]!.tasks
    expect(ideas[0]).toEqual({ text: 'Une idée sans case', done: false, owner: 'agent', thread: null })
    // Parenthesis in the middle: not an owner.
    expect(ideas[1]).toEqual({ text: 'Parenthèses (au milieu) du titre', done: false, owner: null, thread: null })
  })

  it('ignores code, indented lines and text outside a list', () => {
    const all = parseTasks(TASKS).flatMap(l => l.tasks.map(t => t.text))
    expect(all).not.toContain('pas une tâche')
    expect(all.some(t => t.includes('ignorée'))).toBe(false)
    expect(all.some(t => t.includes('détail'))).toBe(false)
    expect(parseTasks('')).toEqual([])
  })

  it('list names in French and English', () => {
    expect(listKind('To test')).toBe('test')
    expect(listKind('A DÉCIDER')).toBe('decide')
    expect(listKind('In progress')).toBe('doing')
    expect(listKind('À faire')).toBe('todo')
    expect(listKind('Plus tard')).toBe('backlog')
    expect(listKind('Done')).toBe('done')
    for (const heading of ['Bloqué', 'Bloque', 'Bloquée', 'Bloquées', 'Blocked', 'On hold', 'En attente', 'Waiting', 'Stuck']) {
      expect(listKind(heading)).toBe('blocked')
    }
    expect(listKind('Notes')).toBeNull()
  })

  it('reads the reason only in a Blocked list, after the owner', () => {
    const lists = parseTasks('## Bloqué\n- [ ] Publier le guide — bloqué par : relecture (agent)\n## Backlog\n- [ ] Publier le guide — bloqué par : relecture (agent)')
    expect(lists[0]!.tasks[0]).toEqual({ text: 'Publier le guide', reason: 'relecture', done: false, owner: 'agent', thread: null })
    expect(lists[1]!.tasks[0]!.text).toBe('Publier le guide — bloqué par : relecture')
    expect(parseTasks('## Blocked\n- [ ] Ship guide — blocked by: review (me)')[0]!.tasks[0]!.reason).toBe('review')
  })

  it('lignes limites', () => {
    expect(parseTaskLine('- [ ]   ')).toBeNull()
    expect(parseTaskLine('- [ ] (me)')?.text).toBe('(me)')
    expect(parseTaskLine('texte libre')).toBeNull()
    expect(parseTaskLine('- [X] Fini')?.done).toBe(true)
  })
  it('a Markdown link at the end of the line stays a link, not the owner', () => {
    expect(parseTaskLine('- [ ] Bandeau [PR](https://github.com/owner/repo/pull/12)', 'review'))
      .toEqual({ text: 'Bandeau [PR](https://github.com/owner/repo/pull/12)', done: false, owner: null, thread: null })
    expect(parseTaskLine('- [ ] Bandeau [PR](https://github.com/owner/repo/pull/12) (me)', 'review')?.owner).toBe('me')
    expect(parseTaskLine('- [ ] Case [x] (me)')?.owner).toBe('me')
  })
})

describe('anciennes lignes : [t-NNNN] et (me)', () => {
  it('bare [t-NNNN] removed from the text, no badge', () => {
    expect(parseTaskLine('- [ ] Bouton Stop [t-0140]')).toEqual({ text: 'Bouton Stop', done: false, owner: null, thread: null })
    expect(parseTaskLine('- [ ] Terminal [T-0140, t-0141; t-0140] (agent)')).toEqual({ text: 'Terminal', done: false, owner: 'agent', thread: null })
  })
  it('ID before or after the owner; owner read but kept out of the text', () => {
    for (const line of ['- [ ] Bouton Stop vraiment [t-0140] (me)', '- [ ] Bouton Stop vraiment (me) [t-0140]']) {
      const x = parseTaskLine(line)!
      expect(x.text).toBe('Bouton Stop vraiment')
      expect(x.owner).toBe('me')
    }
  })
  it('parentheses in the text: the owner is the last group', () => {
    const line = '- [ ] Bouton Stop (clic) pendant une commande (me)'
    expect(parseTaskLine(line)).toMatchObject({ owner: 'me', text: 'Bouton Stop (clic) pendant une commande' })
  })
  it('ordinary brackets kept', () => {
    expect(parseTaskLine('- [ ] Tableau [beta] (me)')?.text).toBe('Tableau [beta]')
  })
})

describe('badges [b:couleur(texte)](cible)', () => {
  it('simple badge: short or long hex normalized, palette, neutral', () => {
    expect(takeBadges('A [b:#fA0(urgent)]').badges).toEqual([{ text: 'urgent', color: '#ffaa00' }])
    expect(takeBadges('A [b:#12abEF(x)]').badges[0]!.color).toBe('#12abef')
    expect(takeBadges('[b:green(ok)] A').badges[0]).toEqual({ text: 'ok', color: 'green' })
    expect(takeBadges('A [b:(neutre)]').badges[0]!.color).toBeNull()
  })
  it('couleur invalide : badge neutre', () => {
    for (const c of ['#12', 'fuchsia', '#ggg', 'url(x)']) expect(badgeColor(c)).toBeNull()
    expect(takeBadges('A [b:fuchsia(x)]').badges[0]).toEqual({ text: 'x', color: null })
  })
  it('badge-lien URL', () => {
    const t = parseTaskLine('- [ ] Bandeau [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)')!
    expect(t).toEqual({ text: 'Bandeau', done: false, owner: 'me', thread: null, badges: [{ text: 'PR #12', color: 'blue', href: 'https://github.com/owner/repo/pull/12' }] })
    expect(takeBadges('A [b:(doc)](http://example.test/a)').badges[0]!.href).toBe('http://example.test/a')
  })
  it('badge-lien thread', () => {
    expect(takeBadges('A [b:gray(t-0140)](T-0140)').badges[0]).toEqual({ text: 't-0140', color: 'gray', thread: 't-0140' })
  })
  it('forbidden scheme: non-clickable badge, target removed from the text', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.test', '//example.test', 'mailto:a@example.test', 'https://']) {
      const r = takeBadges(`A [b:red(x)](${bad}) B`)
      expect(r.badges).toEqual([{ text: 'x', color: 'red' }])
      expect(r.text).toBe('A B')
      expect(badgeTarget(bad)).toBeNull()
    }
  })
  it('several badges anywhere, in order', () => {
    const t = parseTaskLine('- [ ] [b:red(bug)] Bouton Stop [b:blue(iOS)](https://example.test/ios) vraiment [t-0140] (me) [b:(v1.2)]')!
    expect(t.text).toBe('Bouton Stop vraiment')
    expect(t.owner).toBe('me')
    expect(t.badges!.map(b => b.text)).toEqual(['bug', 'iOS', 'v1.2'])
    expect(t.badges![1]!.href).toBe('https://example.test/ios')
  })
  it('parentheses and brackets in the text; HTML kept raw', () => {
    expect(takeBadges('A [b:(a (b) [c])]').badges[0]!.text).toBe('a (b) [c]')
    expect(takeBadges('A [b:(<img src=x onerror=alert(1)>)]').badges[0]!.text).toBe('<img src=x onerror=alert(1)>')
    const long = 'x'.repeat(40)
    expect(takeBadges(`A [b:(${long})]`).badges[0]!.text).toBe(long)
  })
  it('ligne faite seulement de badges : leur texte sert de titre', () => {
    expect(parseTaskLine('- [ ] [b:blue(PR #3)](https://example.test/pr/3)')?.text).toBe('PR #3')
  })
  it('no badge: line unchanged', () => {
    expect(parseTaskLine('- [ ] A [b:()] (me)')).not.toHaveProperty('badges')
  })
})

describe('bare URLs in the text', () => {
  it('rendered as plain links, surrounding text kept', () => {
    expect(textParts('Bandeau https://github.com/o/r/pull/7, merci')).toEqual([
      { text: 'Bandeau ' }, { text: 'https://github.com/o/r/pull/7', href: 'https://github.com/o/r/pull/7' }, { text: ', merci' },
    ])
    expect(textParts('Voir <http://example.test/a>.')).toEqual([{ text: 'Voir ' }, { text: 'http://example.test/a', href: 'http://example.test/a' }, { text: '.' }])
  })
  it('Markdown link: label linked', () => {
    expect(textParts('Voir [la PR](https://example.test/pr/3) ici')).toEqual([{ text: 'Voir ' }, { text: 'la PR', href: 'https://example.test/pr/3' }, { text: ' ici' }])
  })
  it('other schemes: text', () => {
    expect(textParts('javascript:alert(1) et data:x')).toEqual([{ text: 'javascript:alert(1) et data:x' }])
    expect(textParts('[x](javascript:alert(1))')).toEqual([{ text: '[x](javascript:alert(1))' }])
  })
})

describe('answers to decisions (To decide)', () => {
  it('prepares an answer in the chosen language with the task text', () => {
    const task = parseTaskLine('- [ ] Publier le dépôt « wherdr » ? (me)')!
    expect(decisionPrefix(task.text)).toBe('↳ Décision : Publier le dépôt « wherdr » ? — ')
    expect(decisionPrefix(' Publish the repository? ', 'en')).toBe('↳ Decision: Publish the repository? — ')
  })

  it('keeps the draft and puts the answer at the end', () => {
    const answer = decisionPrefix('Publier le dépôt ?')
    expect(prefillDraft('', answer)).toBe(answer)
    expect(prefillDraft('Autre réponse', answer)).toBe(`Autre réponse\n${answer}`)
    expect(prefillDraft(answer, answer)).toBe(answer)
  })
})

describe('actions du Backlog', () => {
  it('builds the message sent by Launch and the Detail draft without the owner', () => {
    const task = parseTaskLine('- [ ] Améliorer le panneau Projet (agent)')!
    expect(launchMessage(task.text)).toBe('↳ Lancer : Améliorer le panneau Projet')
    expect(launchMessage(' Improve the project panel ', 'en')).toBe('↳ Launch: Improve the project panel')
    expect(detailPrefix(task.text)).toBe('↳ Précision sur Améliorer le panneau Projet — ')
    expect(detailPrefix(' Improve the project panel ', 'en')).toBe('↳ Detail on Improve the project panel — ')
  })

  it('keeps the Detail draft and avoids the duplicate on a second tap', () => {
    const detail = detailPrefix('Améliorer le panneau Projet')
    expect(prefillDraft('', detail)).toBe(detail)
    expect(prefillDraft('Autre demande', detail)).toBe(`Autre demande\n${detail}`)
    expect(prefillDraft(detail, detail)).toBe(detail)
  })
})

describe('Blocked actions', () => {
  it('sends Unblock and prepares Detail on the title alone', () => {
    const task = parseTasks('## Bloqué\n- [ ] Publier le guide — bloqué par : relecture (agent)')[0]!.tasks[0]!
    expect(unblockMessage(task.text)).toBe('↳ Débloquer : Publier le guide')
    expect(unblockMessage(' Ship guide ', 'en')).toBe('↳ Unblock: Ship guide')
    expect(detailPrefix(task.text)).toBe('↳ Précision sur Publier le guide — ')
  })
})

const raw = (id: string, o: Record<string, unknown> = {}) => ({
  id, title: `Sujet ${id}`, status: 'open', group: 'Working', group_token: 'working', rank: 4,
  updated: '2026-09-27T02:00:00Z', created: '2026-09-27T01:00:00Z', agent_name: `hp-demo-${id}`,
  machine: '', activity: '', percent: null, pr: '', report: null, ...o,
})

describe('threads', () => {
  it('normalise la sortie de thread list --json', () => {
    const [th] = normalizeThreads([raw('t-0007', { percent: 40.4, report: '/x/threads/t-0007.md', pr: 'javascript:alert(1)' })])
    expect(th).toMatchObject({ id: 't-0007', token: 'working', rank: 4, resolved: false, percent: 40, report: true, pr: '', agentName: 'hp-demo-t-0007' })
    expect(normalizeThreads(null)).toEqual([])
    expect(normalizeThreads([{ id: '../x' }, 'bad', null])).toEqual([])
  })

  it('sorts open threads by attention then most recent, done ones by closing date', () => {
    const list = normalizeThreads([
      raw('t-0001', { status: 'resolved', group: 'Resolved', group_token: 'resolved', rank: 6, updated: '2026-09-26T09:00:00Z' }),
      raw('t-0002', { status: 'resolved', group: 'Resolved', group_token: 'resolved', rank: 6, updated: '2026-09-27T01:00:00Z' }),
      raw('t-0003', { status: 'resolved', group: 'Resolved', group_token: 'resolved', rank: 6, updated: '2026-09-27T01:00:00Z' }),
      raw('t-0010'),
      raw('t-0011', { group: 'Ready for review', group_token: 'ready-for-review', rank: 2 }),
      raw('t-0012'),
      raw('t-0013', { group: 'Waiting on you', group_token: 'waiting-on-you', rank: 1 }),
    ])
    const { open, resolved } = splitThreads(list)
    expect(open.map(t => t.id)).toEqual(['t-0013', 't-0011', 't-0012', 't-0010'])
    expect(resolved.map(t => t.id)).toEqual(['t-0003', 't-0002', 't-0001'])
  })
})

describe('sections du panneau', () => {
  const labels = { doing: 'En cours', done: 'Fait' }
  const threads = splitThreads(normalizeThreads([
    raw('t-0034'),
    raw('t-0040'),
    raw('t-0001', { status: 'resolved', group_token: 'resolved', rank: 6 }),
  ]))

  it('puts open threads in In progress without duplicating the tasks pointing to them', () => {
    const s = boardSections({ lists: parseTasks(TASKS), ...threads }, labels)
    expect(s.map(x => x.title)).toEqual(['À tester', 'À décider', 'En cours', 'Backlog', 'Idées en vrac', 'Fait'])
    const doing = s[2]!
    expect(doing.threads.map(t => t.id)).toEqual(['t-0040', 't-0034'])
    // t-0034 is open: shown through its thread; t-0033 is not in the list: stays a task.
    expect(doing.tasks.map(t => t.thread)).toEqual(['t-0033', null])
    expect(s.at(-1)!.threads.map(t => t.id)).toEqual(['t-0001'])
  })

  it('adds In progress and Done when TASKS.md does not have them', () => {
    const s = boardSections({ lists: parseTasks('## À tester\n- [ ] a (me)\n## Backlog\n- [ ] b\n## Fait\n- [x] c\n## Notes\n'), ...threads }, labels)
    expect(s.map(x => [x.title, x.kind])).toEqual([
      ['À tester', 'test'], ['En cours', 'doing'], ['Backlog', 'backlog'], ['Notes', null], ['Fait', 'done'],
    ])
    expect(s.at(-1)!.tasks.map(t => t.text)).toEqual(['c'])
    // No TASKS.md: In progress (if threads are running) and Done.
    expect(boardSections({ lists: [], open: [], resolved: [] }, labels).map(x => x.kind)).toEqual(['done'])
  })

  it('places a missing In progress at its canonical place, before Blocked', () => {
    const lists = parseTasks('## À décider\n## Bloqué\n- [ ] Attendre une revue\n## Backlog')
    expect(boardSections({ lists, ...threads }, labels).map(s => s.kind)).toEqual(['decide', 'doing', 'blocked', 'backlog', 'done'])
    expect(boardSections({ lists: parseTasks('## En cours\n## Bloqué'), ...threads }, labels).map(s => s.kind)).toEqual(['doing', 'blocked', 'done'])
  })

  it('leaves a waiting thread in In progress, without confusing it with the Blocked list', () => {
    const waiting = normalizeThreads([raw('t-0002', { group: 'Waiting on you', group_token: 'waiting-on-you', rank: 1 })])
    const sections = boardSections({ lists: parseTasks('## Bloqué\n- [ ] Validation externe\n## En cours'), open: waiting, resolved: [] }, labels)
    expect(sections.find(s => s.kind === 'blocked')!.threads).toEqual([])
    expect(sections.find(s => s.kind === 'doing')!.threads.map(t => t.id)).toEqual(['t-0002'])
  })
})

describe('herdr-projects installed', () => {
  it('finds the binary in the plugin manifest', () => {
    const plugin = {
      plugin_id: 'herdr-projects', enabled: true, plugin_root: '/h/.config/herdr/plugins/github/herdr-projects-abc',
      startup: [{ command: ['target/release/herdr-projects', 'startup'] }],
    }
    expect(pluginBinary([plugin])).toBe('/h/.config/herdr/plugins/github/herdr-projects-abc/target/release/herdr-projects')
    expect(pluginBinary([{ ...plugin, enabled: false }])).toBeNull()
    expect(pluginBinary([{ ...plugin, startup: [{ command: ['../../bin/herdr-projects'] }] }])).toBeNull()
    expect(pluginBinary([{ ...plugin, startup: [{ command: ['sh', 'x'] }], actions: [{ command: ['/opt/hp/herdr-projects', 'action'] }] }])).toBe('/opt/hp/herdr-projects')
    expect(pluginBinary([{ plugin_id: 'autre', plugin_root: '/x', startup: plugin.startup }])).toBeNull()
    expect(pluginBinary([])).toBeNull()
  })

  it('recognizes a coordinator', () => {
    const base: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/u/.herdr-projects/demo', agentSession: null }
    expect(isCoordinator(base)).toBe(true)
    expect(isCoordinator({ ...base, agent: null })).toBe(false)
    expect(isCoordinator({ ...base, cwd: '/home/u/code' })).toBe(false)
    expect(isCoordinator({ ...base, name: 'hp-demo-t-0001-x', cwd: '/home/u/.herdr/worktrees/r/hp-demo-t-0001-x' })).toBe(false)
  })
})

describe('test feedback (To test)', () => {
  it('Confirm: message with the exact task text', () => {
    expect(testedMessage('Réglages › Agents : décocher Kimi')).toBe('✓ Testé : Réglages › Agents : décocher Kimi')
    expect(testedMessage('  Étoile animée ')).toBe('✓ Testé : Étoile animée')
    expect(testedMessage('Star', 'en')).toBe('✓ Tested: Star')
  })
  it('task text taken from TASKS.md (without the owner)', () => {
    const task = parseTaskLine('- [ ] Panneau « Projet » (au milieu) : ok ? (me)')!
    expect(testedMessage(task.text)).toBe('✓ Testé : Panneau « Projet » (au milieu) : ok ?')
  })
  it('Problem: message start, cursor after the dash', () => {
    expect(problemPrefix('Étoile animée')).toBe('✗ Problème : Étoile animée — ')
    expect(problemPrefix('Star', 'en')).toBe('✗ Problem: Star — ')
  })
  it('Question: message start, cursor after the dash', () => {
    expect(questionPrefix('Étoile animée')).toBe('? Question : Étoile animée — ')
    expect(questionPrefix(' Star ', 'en')).toBe('? Question: Star — ')
    const q = questionPrefix('Étoile animée')
    expect(prefillDraft('', q)).toBe(q)
    expect(prefillDraft(q, q)).toBe(q)
    // After a problem on the same task: the question goes on a new line.
    const pb = problemPrefix('Étoile animée')
    expect(prefillDraft(`${pb}elle ne tourne pas`, q)).toBe(`${pb}elle ne tourne pas\n${q}`)
  })
  it('prefill: empty field, draft kept, double tap', () => {
    const pre = problemPrefix('Étoile animée')
    expect(prefillDraft('', pre)).toBe(pre)
    expect(prefillDraft('  \n', pre)).toBe(pre)
    expect(prefillDraft('Autre chose', pre)).toBe(`Autre chose\n${pre}`)
    expect(prefillDraft(pre, pre)).toBe(pre)
    expect(prefillDraft(`Autre chose\n${pre}`, pre)).toBe(`Autre chose\n${pre}`)
    // Explanation already started: a new report follows it.
    expect(prefillDraft(`${pre}elle ne tourne pas`, pre)).toBe(`${pre}elle ne tourne pas\n${pre}`)
  })
})

describe('board help (Settings › Plugins)', () => {
  it('the TASKS.md template reads back with the recognized lists', async () => {
    const { tasksTemplate, parseTasks } = await import('../shared/projectBoard')
    for (const lang of ['fr', 'en'] as const) {
      const md = tasksTemplate(lang)
      expect(md.startsWith('# Tasks\n')).toBe(true)
      const lists = parseTasks(md)
      expect(lists.map(l => l.kind)).toEqual(['test', 'decide', 'review', 'doing', 'queue', 'blocked', 'todo', 'backlog'])
      expect(lists.every(l => l.tasks.length === 1)).toBe(true)
    }
    expect(parseTasks(tasksTemplate('fr'))[0]!.title).toBe('À tester')
    expect(parseTasks(tasksTemplate('en'))[1]!.title).toBe('To decide')
  })
  it('detects missing To test / To decide lists', async () => {
    const { missingLists, parseTasks } = await import('../shared/projectBoard')
    expect(missingLists(parseTasks('## Backlog\n- [ ] a'))).toEqual(['test', 'decide'])
    expect(missingLists(parseTasks('## To verify\n## Questions'))).toEqual([])
    expect(missingLists(parseTasks('## À tester\n## Idées'))).toEqual(['decide'])
  })
  it('Add info names the thread and keeps the text as typed', async () => {
    const m = await import('../shared/projectBoard')
    expect(m.infoMessage('t-0012', 'Use the staging key', 'en')).toBe('↳ Info for t-0012: Use the staging key')
    expect(m.infoMessage('t-0012', 'Utilise la clé de recette')).toBe('↳ Info pour t-0012 : Utilise la clé de recette')
    expect(m.infoMessage('t-0012', 'Utilise la clé de recette', 'fr')).toBe('↳ Info pour t-0012 : Utilise la clé de recette')
    // Several lines: sent whole, only the ends trimmed.
    expect(m.infoMessage(' t-12345 ', '\n  Two things:\n- the limit is per key\n\n- 429 needs Retry-After  \n', 'en'))
      .toBe('↳ Info for t-12345: Two things:\n- the limit is per key\n\n- 429 needs Retry-After')
    expect(m.infoMessage('t-0140', 'ligne 1\nligne 2 : suite', 'fr')).toBe('↳ Info pour t-0140 : ligne 1\nligne 2 : suite')
  })
  it('the rules repeat the messages sent by the panel', async () => {
    const m = await import('../shared/projectBoard')
    const fr = m.coordinatorRules('fr')
    expect(fr).toContain(m.infoMessage('t-0140', '…', 'fr'))
    expect(m.coordinatorRules('en')).toContain(m.infoMessage('t-0140', '…', 'en'))
    expect(fr).toContain(m.testedMessage('…'))
    expect(fr).toContain(m.launchMessage('…', 'fr'))
    expect(fr).toContain(m.unblockMessage('…', 'fr'))
    expect(fr).toContain('Déplacer une tâche en Bloqué')
    for (const a of ['up', 'down', 'queue', 'now', 'unqueue', 'backlog'] as const) {
      expect(fr).toContain(m.moveMessage(a, '…', 'fr'))
      expect(m.coordinatorRules('en')).toContain(m.moveMessage(a, '…', 'en'))
    }
    // Lists are optional, In queue is the auto-launch contract, badges are free-form.
    expect(fr).toContain('toutes facultatives')
    expect(m.coordinatorRules('en')).toContain('all optional')
    expect(m.coordinatorRules('en')).toContain('In queue contract')
    expect(m.coordinatorRules('en')).toContain('Badges are free-form')
    // A single badge syntax, to be used autonomously.
    expect(fr).toContain('[b:couleur(texte)](cible)')
    expect(fr).toContain('de toi-même')
    expect(m.coordinatorRules('en')).toContain('on your own')
    expect(fr).not.toContain('[t-0140, t-0141]')
    expect(m.coordinatorRules('en')).toContain(m.launchMessage('…', 'en'))
    expect(m.coordinatorRules('en')).toContain(m.unblockMessage('…', 'en'))
    for (const p of [m.problemPrefix, m.questionPrefix, m.decisionPrefix, m.detailPrefix]) {
      expect(fr).toContain(p('…', 'fr'))
      expect(m.coordinatorRules('en')).toContain(p('…', 'en'))
    }
  })
})

describe('To review list', () => {
  it('recognizes titles and synonyms', () => {
    for (const h of ['À relire', 'To review', 'a relire', 'Relire', 'Review', 'Reviews', 'PR', 'PRs', 'Pull requests', 'À valider'])
      expect(listKind(h)).toBe('review')
    expect(listKind('Previews')).toBeNull()
  })
  it('reads the list and keeps the owner; the URL stays in the text', () => {
    const [l] = parseTasks('## À relire\n- [ ] Bandeau — https://github.com/o/r/pull/7 (me)')
    expect(l!.kind).toBe('review')
    expect(l!.tasks[0]).toEqual({ text: 'Bandeau — https://github.com/o/r/pull/7', done: false, owner: 'me', thread: null })
  })
  it('messages Relu et Commenter', () => {
    expect(reviewedMessage(' Bandeau ')).toBe('✓ Relu : Bandeau')
    expect(reviewedMessage('Banner', 'en')).toBe('✓ Reviewed: Banner')
    expect(reviewCommentPrefix('Bandeau')).toBe('↳ Retour sur Bandeau : ')
    expect(coordinatorRules()).toContain('✓ Relu : …')
  })
  it('In progress goes after To review', () => {
    const lists = parseTasks('## À relire\n- [ ] a\n## Backlog')
    const open = [{ id: 't-0001' }] as never
    expect(boardSections({ lists, open, resolved: [] }, { doing: 'En cours', done: 'Fait' }).map(s => s.kind)).toEqual(['review', 'doing', 'backlog', 'done'])
  })
})

describe('Masquer les listes vides', () => {
  const lists = parseTasks('## À tester\n## À décider\n- [ ] Choix (me)\n## En cours\n## Backlog')
  const labels = { doing: 'En cours', done: 'Fait' }
  const all = boardSections({ lists, open: [], resolved: [] }, labels)
  it('setting off: all lists', () => {
    expect(visibleSections(all, false).map(s => s.kind)).toEqual(['test', 'decide', 'doing', 'backlog', 'done'])
  })
  it('setting on: only lists with items, In progress and Done included', () => {
    expect(visibleSections(all, true).map(s => s.kind)).toEqual(['decide'])
    const open = normalizeThreads([{ id: 't-0002', status: 'open' }])
    expect(visibleSections(boardSections({ lists, open, resolved: [] }, labels), true).map(s => s.kind)).toEqual(['decide', 'doing'])
  })
  it('a hidden empty list does not trigger the suggestion', () => {
    expect(missingListsOf(lists)).toEqual([])
  })
})

describe('In queue and To do lists', () => {
  it('recognizes titles and synonyms; To do is no longer Backlog', () => {
    for (const h of ['En file', 'En file d’attente', 'File d’attente', 'In queue', 'Queue', 'Queued', 'Up next'])
      expect(listKind(h)).toBe('queue')
    for (const h of ['À faire', 'A faire', 'To do', 'Todo', 'TODO', 'Next', 'Soon', 'Prochainement'])
      expect(listKind(h)).toBe('todo')
    for (const h of ['Backlog', 'Later', 'Plus tard', 'Idées', 'Ideas', 'Someday'])
      expect(listKind(h)).toBe('backlog')
  })

  it('shows lists in the canonical order whatever the file order; unknown lists after Backlog', () => {
    const md = ['Fait', 'Backlog', 'Notes', 'À faire', 'Bloqué', 'En file', 'En cours', 'À relire', 'À décider', 'Idées en vrac', 'À tester']
      .map(t => `## ${t}\n- [ ] ${t} (me)`).join('\n')
    const s = boardSections({ lists: parseTasks(md), open: [], resolved: [] }, { doing: 'En cours', done: 'Fait' })
    expect(s.map(x => x.title)).toEqual(['À tester', 'À décider', 'À relire', 'En cours', 'En file', 'Bloqué', 'À faire', 'Backlog', 'Notes', 'Idées en vrac', 'Fait'])
    expect(s.map(x => x.kind)).toEqual(['test', 'decide', 'review', 'doing', 'queue', 'blocked', 'todo', 'backlog', null, null, 'done'])
  })

  it('keeps the file order between lists of the same kind', () => {
    const s = boardSections({ lists: parseTasks('## Plus tard\n## Backlog\n## Next\n## À faire'), open: [], resolved: [] }, { doing: 'En cours', done: 'Fait' })
    expect(s.map(x => x.title)).toEqual(['Next', 'À faire', 'Plus tard', 'Backlog', 'Fait'])
  })

  it('move messages, in French and English', () => {
    expect(moveMessage('up', ' Export CSV ')).toBe('↳ Monter : Export CSV')
    expect(moveMessage('down', 'Export CSV')).toBe('↳ Descendre : Export CSV')
    expect(moveMessage('queue', 'Export CSV')).toBe('↳ Mettre en file : Export CSV')
    expect(moveMessage('now', 'Export CSV')).toBe('↳ Lancer maintenant : Export CSV')
    expect(moveMessage('unqueue', 'Export CSV')).toBe('↳ Retirer de la file : Export CSV')
    expect(moveMessage('backlog', 'Export CSV')).toBe('↳ Remettre au backlog : Export CSV')
    expect(moveMessage('up', 'Export', 'en')).toBe('↳ Move up: Export')
    expect(moveMessage('down', 'Export', 'en')).toBe('↳ Move down: Export')
    expect(moveMessage('queue', 'Export', 'en')).toBe('↳ Queue: Export')
    expect(moveMessage('now', 'Export', 'en')).toBe('↳ Launch now: Export')
    expect(moveMessage('unqueue', 'Export', 'en')).toBe('↳ Remove from queue: Export')
    expect(moveMessage('backlog', 'Export', 'en')).toBe('↳ Back to backlog: Export')
  })

  it('slot status line of the In queue header', () => {
    expect(queueStatus({ used: 2, max: 3 }, 'Export CSV', 'en')).toBe('2 of 3 thread slots in use · next: Export CSV')
    expect(queueStatus({ used: 1, max: 1 }, undefined, 'en')).toBe('1 of 1 thread slot in use')
    expect(queueStatus({ used: 2, max: 2 }, 'Export CSV', 'fr')).toBe('2 places de thread sur 2 occupées · ensuite : Export CSV')
    expect(queueStatus({ used: 0, max: 2 }, '', 'fr')).toBe('0 place de thread sur 2 occupée')
    // No data: no line.
    expect(queueStatus(undefined, 'Export CSV')).toBeNull()
  })

  it('reads max_parallel_threads from the PROJECT.md front matter', () => {
    const head = (body: string) => `+++\nname = "Demo"\n${body}\n[[repos]]\npath = "/srv/app"\n+++\n\n# Instructions\nmax_parallel_threads = 99\n`
    expect(maxParallelThreads(head('max_parallel_threads = 2'))).toBe(2)
    expect(maxParallelThreads(head('max_parallel_threads = 4 # cap'))).toBe(4)
    // Absent: herdr-projects' default.
    expect(maxParallelThreads(head(''))).toBe(10)
    expect(maxParallelThreads(head('max_parallel_threads = 0'))).toBeNull()
    expect(maxParallelThreads('# No front matter\nmax_parallel_threads = 3')).toBeNull()
    expect(maxParallelThreads('')).toBeNull()
  })
})
