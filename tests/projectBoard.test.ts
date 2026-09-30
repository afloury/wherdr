import { describe, expect, it } from 'vitest'
import { boardSections, visibleSections, missingLists as missingListsOf, coordinatorRules, decisionPrefix, classifyLink, extractLinks, prLabel, reviewCommentPrefix, reviewedMessage, detailPrefix, launchMessage, listKind, normalizeThreads, ownerIsMe, parseTaskLine, parseTasks, prefillDraft, problemPrefix, questionPrefix, splitThreads, testedMessage, unblockMessage } from '../shared/projectBoard'
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
  it('lit toutes les listes dans leur ordre, noms connus reconnus', () => {
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

  it('reconnaît les responsables, y compris un thread', () => {
    const doing = parseTasks(TASKS)[2]!.tasks
    expect(doing.map(t => [t.owner, t.thread])).toEqual([
      ['agent → t-0034', 't-0034'],
      ['agent -> t-0033', 't-0033'],
      ['Alice', null],
    ])
    const ideas = parseTasks(TASKS)[3]!.tasks
    expect(ideas[0]).toEqual({ text: 'Une idée sans case', done: false, owner: 'agent', thread: null })
    // Parenthèse au milieu : pas un responsable.
    expect(ideas[1]).toEqual({ text: 'Parenthèses (au milieu) du titre', done: false, owner: null, thread: null })
  })

  it('ignore le code, les lignes indentées et le texte hors liste', () => {
    const all = parseTasks(TASKS).flatMap(l => l.tasks.map(t => t.text))
    expect(all).not.toContain('pas une tâche')
    expect(all.some(t => t.includes('ignorée'))).toBe(false)
    expect(all.some(t => t.includes('détail'))).toBe(false)
    expect(parseTasks('')).toEqual([])
  })

  it('noms de listes en français et en anglais', () => {
    expect(listKind('To test')).toBe('test')
    expect(listKind('A DÉCIDER')).toBe('decide')
    expect(listKind('In progress')).toBe('doing')
    expect(listKind('À faire')).toBe('backlog')
    expect(listKind('Done')).toBe('done')
    for (const heading of ['Bloqué', 'Bloque', 'Bloquée', 'Bloquées', 'Blocked', 'On hold', 'En attente', 'Waiting', 'Stuck']) {
      expect(listKind(heading)).toBe('blocked')
    }
    expect(listKind('Notes')).toBeNull()
  })

  it('lit la raison uniquement dans une liste Bloqué, après le responsable', () => {
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
    expect(ownerIsMe('me')).toBe(true)
    expect(ownerIsMe('Moi')).toBe(true)
    expect(ownerIsMe('agent')).toBe(false)
    expect(ownerIsMe(null)).toBe(false)
  })
  it('un lien Markdown en fin de ligne reste un lien, pas le responsable', () => {
    expect(parseTaskLine('- [ ] Bandeau [PR](https://github.com/owner/repo/pull/12)', 'review'))
      .toEqual({ text: 'Bandeau PR', done: false, owner: null, thread: null, links: ['https://github.com/owner/repo/pull/12'] })
    expect(parseTaskLine('- [ ] Bandeau [PR](https://github.com/owner/repo/pull/12) (me)', 'review')?.owner).toBe('me')
    expect(parseTaskLine('- [ ] Case [x] (me)')?.owner).toBe('me')
  })
})

describe('réponses aux décisions (À décider)', () => {
  it('prépare une réponse dans la langue choisie avec le texte de la tâche', () => {
    const task = parseTaskLine('- [ ] Publier le dépôt « wherdr » ? (me)')!
    expect(decisionPrefix(task.text)).toBe('↳ Décision : Publier le dépôt « wherdr » ? — ')
    expect(decisionPrefix(' Publish the repository? ', 'en')).toBe('↳ Decision: Publish the repository? — ')
  })

  it('préserve le brouillon et place la réponse à la fin', () => {
    const answer = decisionPrefix('Publier le dépôt ?')
    expect(prefillDraft('', answer)).toBe(answer)
    expect(prefillDraft('Autre réponse', answer)).toBe(`Autre réponse\n${answer}`)
    expect(prefillDraft(answer, answer)).toBe(answer)
  })
})

describe('actions du Backlog', () => {
  it('compose le message envoyé par Lancer et le brouillon de Préciser sans responsable', () => {
    const task = parseTaskLine('- [ ] Améliorer le panneau Projet (agent)')!
    expect(launchMessage(task.text)).toBe('↳ Lancer : Améliorer le panneau Projet')
    expect(launchMessage(' Improve the project panel ', 'en')).toBe('↳ Launch: Improve the project panel')
    expect(detailPrefix(task.text)).toBe('↳ Précision sur Améliorer le panneau Projet — ')
    expect(detailPrefix(' Improve the project panel ', 'en')).toBe('↳ Detail on Improve the project panel — ')
  })

  it('garde le brouillon de Préciser et évite le doublon au second toucher', () => {
    const detail = detailPrefix('Améliorer le panneau Projet')
    expect(prefillDraft('', detail)).toBe(detail)
    expect(prefillDraft('Autre demande', detail)).toBe(`Autre demande\n${detail}`)
    expect(prefillDraft(detail, detail)).toBe(detail)
  })
})

describe('actions de Bloqué', () => {
  it('envoie Débloquer et prépare Préciser sur le titre seul', () => {
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

  it('trie les ouverts par attention puis du plus récent, les faits par date de clôture', () => {
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

  it('met les threads ouverts dans En cours sans doubler les tâches qui y renvoient', () => {
    const s = boardSections({ lists: parseTasks(TASKS), ...threads }, labels)
    expect(s.map(x => x.title)).toEqual(['À tester', 'À décider', 'En cours', 'Idées en vrac', 'Backlog', 'Fait'])
    const doing = s[2]!
    expect(doing.threads.map(t => t.id)).toEqual(['t-0040', 't-0034'])
    // t-0034 est ouvert : montré par son thread ; t-0033 n'est pas dans la liste : reste une tâche.
    expect(doing.tasks.map(t => t.thread)).toEqual(['t-0033', null])
    expect(s.at(-1)!.threads.map(t => t.id)).toEqual(['t-0001'])
  })

  it('ajoute En cours et Fait quand TASKS.md ne les a pas', () => {
    const s = boardSections({ lists: parseTasks('## À tester\n- [ ] a (me)\n## Backlog\n- [ ] b\n## Fait\n- [x] c\n## Notes\n'), ...threads }, labels)
    expect(s.map(x => [x.title, x.kind])).toEqual([
      ['À tester', 'test'], ['En cours', 'doing'], ['Backlog', 'backlog'], ['Notes', null], ['Fait', 'done'],
    ])
    expect(s.at(-1)!.tasks.map(t => t.text)).toEqual(['c'])
    // Pas de TASKS.md : En cours (si des threads tournent) et Fait.
    expect(boardSections({ lists: [], open: [], resolved: [] }, labels).map(x => x.kind)).toEqual(['done'])
  })

  it('place En cours après Bloqué si cette section est absente, tout en respectant le fichier', () => {
    const lists = parseTasks('## À décider\n## Bloqué\n- [ ] Attendre une revue\n## Backlog')
    expect(boardSections({ lists, ...threads }, labels).map(s => s.kind)).toEqual(['decide', 'blocked', 'doing', 'backlog', 'done'])
    expect(boardSections({ lists: parseTasks('## En cours\n## Bloqué'), ...threads }, labels).map(s => s.kind)).toEqual(['doing', 'blocked', 'done'])
  })

  it('laisse un thread en attente dans En cours, sans le confondre avec la liste Bloqué', () => {
    const waiting = normalizeThreads([raw('t-0002', { group: 'Waiting on you', group_token: 'waiting-on-you', rank: 1 })])
    const sections = boardSections({ lists: parseTasks('## Bloqué\n- [ ] Validation externe\n## En cours'), open: waiting, resolved: [] }, labels)
    expect(sections.find(s => s.kind === 'blocked')!.threads).toEqual([])
    expect(sections.find(s => s.kind === 'doing')!.threads.map(t => t.id)).toEqual(['t-0002'])
  })
})

describe('herdr-projects installé', () => {
  it('trouve le binaire dans le manifeste du plugin', () => {
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

  it('reconnaît un coordinateur', () => {
    const base: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/u/.herdr-projects/demo', agentSession: null }
    expect(isCoordinator(base)).toBe(true)
    expect(isCoordinator({ ...base, agent: null })).toBe(false)
    expect(isCoordinator({ ...base, cwd: '/home/u/code' })).toBe(false)
    expect(isCoordinator({ ...base, name: 'hp-demo-t-0001-x', cwd: '/home/u/.herdr/worktrees/r/hp-demo-t-0001-x' })).toBe(false)
  })
})

describe('retours de test (À tester)', () => {
  it('Confirmer : message avec le texte exact de la tâche', () => {
    expect(testedMessage('Réglages › Agents : décocher Kimi')).toBe('✓ Testé : Réglages › Agents : décocher Kimi')
    expect(testedMessage('  Étoile animée ')).toBe('✓ Testé : Étoile animée')
    expect(testedMessage('Star', 'en')).toBe('✓ Tested: Star')
  })
  it('texte de tâche tiré de TASKS.md (sans le responsable)', () => {
    const task = parseTaskLine('- [ ] Panneau « Projet » (au milieu) : ok ? (me)')!
    expect(testedMessage(task.text)).toBe('✓ Testé : Panneau « Projet » (au milieu) : ok ?')
  })
  it('Problème : début de message, curseur après le tiret', () => {
    expect(problemPrefix('Étoile animée')).toBe('✗ Problème : Étoile animée — ')
    expect(problemPrefix('Star', 'en')).toBe('✗ Problem: Star — ')
  })
  it('Question : début de message, curseur après le tiret', () => {
    expect(questionPrefix('Étoile animée')).toBe('? Question : Étoile animée — ')
    expect(questionPrefix(' Star ', 'en')).toBe('? Question: Star — ')
    const q = questionPrefix('Étoile animée')
    expect(prefillDraft('', q)).toBe(q)
    expect(prefillDraft(q, q)).toBe(q)
    // Après un problème sur la même tâche : la question vient à la ligne.
    const pb = problemPrefix('Étoile animée')
    expect(prefillDraft(`${pb}elle ne tourne pas`, q)).toBe(`${pb}elle ne tourne pas\n${q}`)
  })
  it('préremplissage : champ vide, brouillon gardé, double toucher', () => {
    const pre = problemPrefix('Étoile animée')
    expect(prefillDraft('', pre)).toBe(pre)
    expect(prefillDraft('  \n', pre)).toBe(pre)
    expect(prefillDraft('Autre chose', pre)).toBe(`Autre chose\n${pre}`)
    expect(prefillDraft(pre, pre)).toBe(pre)
    expect(prefillDraft(`Autre chose\n${pre}`, pre)).toBe(`Autre chose\n${pre}`)
    // Explication déjà commencée : un nouveau signalement vient à la suite.
    expect(prefillDraft(`${pre}elle ne tourne pas`, pre)).toBe(`${pre}elle ne tourne pas\n${pre}`)
  })
})

describe('aide du tableau (Réglages › Plugins)', () => {
  it('le modèle TASKS.md se relit avec les listes reconnues', async () => {
    const { tasksTemplate, parseTasks } = await import('../shared/projectBoard')
    for (const lang of ['fr', 'en'] as const) {
      const md = tasksTemplate(lang)
      expect(md.startsWith('# Tasks\n')).toBe(true)
      const lists = parseTasks(md)
      expect(lists.map(l => l.kind)).toEqual(['test', 'decide', 'review', 'blocked', 'doing', 'backlog'])
      expect(lists.every(l => l.tasks.length === 1)).toBe(true)
    }
    expect(parseTasks(tasksTemplate('fr'))[0]!.title).toBe('À tester')
    expect(parseTasks(tasksTemplate('en'))[1]!.title).toBe('To decide')
  })
  it('détecte les listes À tester / À décider manquantes', async () => {
    const { missingLists, parseTasks } = await import('../shared/projectBoard')
    expect(missingLists(parseTasks('## Backlog\n- [ ] a'))).toEqual(['test', 'decide'])
    expect(missingLists(parseTasks('## To verify\n## Questions'))).toEqual([])
    expect(missingLists(parseTasks('## À tester\n## Idées'))).toEqual(['decide'])
  })
  it('les règles reprennent les messages envoyés par le panneau', async () => {
    const m = await import('../shared/projectBoard')
    const fr = m.coordinatorRules('fr')
    expect(fr).toContain(m.testedMessage('…'))
    expect(fr).toContain(m.launchMessage('…', 'fr'))
    expect(fr).toContain(m.unblockMessage('…', 'fr'))
    expect(fr).toContain('Déplacer une tâche en Bloqué')
    expect(m.coordinatorRules('en')).toContain(m.launchMessage('…', 'en'))
    expect(m.coordinatorRules('en')).toContain(m.unblockMessage('…', 'en'))
    for (const p of [m.problemPrefix, m.questionPrefix, m.decisionPrefix, m.detailPrefix]) {
      expect(fr).toContain(p('…', 'fr'))
      expect(m.coordinatorRules('en')).toContain(p('…', 'en'))
    }
  })
})

describe('liste À relire', () => {
  it('reconnaît les titres et synonymes', () => {
    for (const h of ['À relire', 'To review', 'a relire', 'Relire', 'Review', 'Reviews', 'PR', 'PRs', 'Pull requests', 'À valider'])
      expect(listKind(h)).toBe('review')
    expect(listKind('Previews')).toBeNull()
  })
  it('retire les liens https du texte', () => {
    expect(extractLinks('Bandeau hors ligne https://github.com/owner/repo/pull/12')).toEqual({ text: 'Bandeau hors ligne', links: ['https://github.com/owner/repo/pull/12'] })
    expect(extractLinks('Voir [la PR](https://gitlab.com/g/p/-/merge_requests/3), merci')).toEqual({ text: 'Voir la PR, merci', links: ['https://gitlab.com/g/p/-/merge_requests/3'] })
    expect(extractLinks('Ancien http://example.test/x et <https://example.test/a>.')).toEqual({ text: 'Ancien http://example.test/x et.', links: ['https://example.test/a'] })
    expect(extractLinks('javascript:alert(1)').links).toEqual([])
  })
  it('lit la liste et garde le responsable', () => {
    const [l] = parseTasks('## À relire\n- [ ] Bandeau — https://github.com/o/r/pull/7 (me)\n- [ ] https://git.example.test/o/r/pull-requests/4')
    expect(l!.kind).toBe('review')
    expect(l!.tasks[0]).toMatchObject({ text: 'Bandeau', owner: 'me', links: ['https://github.com/o/r/pull/7'] })
    expect(l!.tasks[1]!.text).toBe('r#4')
    expect(prLabel('https://example.test/doc')).toBe('example.test')
  })
  it('messages Relu et Commenter', () => {
    expect(reviewedMessage(' Bandeau ')).toBe('✓ Relu : Bandeau')
    expect(reviewedMessage('Banner', 'en')).toBe('✓ Reviewed: Banner')
    expect(reviewCommentPrefix('Bandeau')).toBe('↳ Retour sur Bandeau : ')
    expect(coordinatorRules()).toContain('✓ Relu : …')
  })
  it('En cours se place après À relire', () => {
    const lists = parseTasks('## À relire\n- [ ] a\n## Backlog')
    const open = [{ id: 't-0001' }] as never
    expect(boardSections({ lists, open, resolved: [] }, { doing: 'En cours', done: 'Fait' }).map(s => s.kind)).toEqual(['review', 'doing', 'backlog', 'done'])
  })
})

describe('Masquer les listes vides', () => {
  const lists = parseTasks('## À tester\n## À décider\n- [ ] Choix (me)\n## En cours\n## Backlog')
  const labels = { doing: 'En cours', done: 'Fait' }
  const all = boardSections({ lists, open: [], resolved: [] }, labels)
  it('réglage coupé : toutes les listes', () => {
    expect(visibleSections(all, false).map(s => s.kind)).toEqual(['test', 'decide', 'doing', 'backlog', 'done'])
  })
  it('réglage actif : seulement les listes avec des éléments, En cours et Fait compris', () => {
    expect(visibleSections(all, true).map(s => s.kind)).toEqual(['decide'])
    const open = normalizeThreads([{ id: 't-0002', status: 'open' }])
    expect(visibleSections(boardSections({ lists, open, resolved: [] }, labels), true).map(s => s.kind)).toEqual(['decide', 'doing'])
  })
  it('une liste vide masquée ne déclenche pas la suggestion', () => {
    expect(missingListsOf(lists)).toEqual([])
  })
})

describe('classifyLink', () => {
  it('reconnaît les vrais liens de PR/MR', () => {
    expect(classifyLink('https://github.com/o/r/pull/12')).toEqual({ pr: true, label: 'r#12', repo: 'r', number: 12 })
    expect(classifyLink('https://github.com/o/r/pull/12/files')).toMatchObject({ pr: true, label: 'r#12' })
    expect(classifyLink('https://gitlab.example.com/g/sub/app/-/merge_requests/3')).toMatchObject({ pr: true, label: 'app#3' })
    expect(classifyLink('https://bitbucket.org/ws/lib/pull-requests/45/overview')).toMatchObject({ pr: true, label: 'lib#45' })
    expect(classifyLink('https://dev.azure.com/org/proj/_git/svc/pullrequest/9')).toMatchObject({ pr: true, label: 'svc#9' })
  })
  it('laisse les autres liens ordinaires', () => {
    expect(classifyLink('https://github.com/o/r')).toEqual({ pr: false, label: 'github.com/o/r' })
    expect(classifyLink('https://github.com/o/r/issues/5')).toMatchObject({ pr: false })
    expect(classifyLink('https://github.com/o/r/pull/abc')).toMatchObject({ pr: false })
    expect(classifyLink('https://app.example.com/')).toEqual({ pr: false, label: 'app.example.com' })
    expect(classifyLink('https://www.example.com/docs/a/very/long/path/here')).toEqual({ pr: false, label: 'example.com/docs/a/very/long/path/…' })
    expect(classifyLink('pas une url')).toEqual({ pr: false, label: 'pas une url' })
  })
})
