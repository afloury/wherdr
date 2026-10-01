import { describe, expect, it } from 'vitest'
import { cleanProjectInput, conversationEmpty, doctorLevel, goalWithTask, projectCommandArgs, setupHeader } from '../shared/projectsActions'

describe('herdr-projects : saisies et arguments', () => {
  it('requires a name, the goal staying optional, for adoption and "New project"', () => {
    expect(cleanProjectInput('adopt-workspace', { name: 'Demo', goal: '' })).toEqual({ name: 'Demo' })
    expect(cleanProjectInput('adopt-workspace', { name: 'Demo', goal: '  ', task: ' fix  Y ' })).toEqual({ name: 'Demo', task: 'fix Y' })
    expect(cleanProjectInput('new', { name: 'Demo' })).toEqual({ name: 'Demo' })
    expect(cleanProjectInput('new', { goal: 'g' })).toBeNull()
    expect(cleanProjectInput('new', { name: ' ', goal: 'g' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', goal: 3 })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', goal: 'x'.repeat(401) })).toBeNull()
    expect(cleanProjectInput('new', { name: '  Demo ', goal: ' Ship  it ', repo: '' })).toEqual({ name: 'Demo', goal: 'Ship it' })
    expect(cleanProjectInput('open', { slug: 'demo' })).toEqual({ slug: 'demo' })
    expect(cleanProjectInput('new', { name: 'x'.repeat(121), goal: 'g' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', goal: 'g', repo: 42 })).toBeNull()
    expect(cleanProjectInput('delete', { slug: 'demo' })).toBeNull()
  })

  it('refuses a name or slug read as an option, and a name refused by the form', () => {
    expect(cleanProjectInput('new', { name: '--help' })).toBeNull()
    expect(cleanProjectInput('adopt-workspace', { name: '-x' })).toBeNull()
    expect(cleanProjectInput('open', { slug: '--session=autre' })).toBeNull()
    expect(cleanProjectInput('new', { name: '~' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'a/b' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo-2' })).toEqual({ name: 'Demo-2' })
  })

  it('builds adopt-workspace with the goal, the current task and the session', () => {
    const input = cleanProjectInput('adopt-workspace', { name: 'Demo', goal: 'Faire X', task: 'corriger Y' })!
    expect(projectCommandArgs('adopt-workspace', input, { pane: 'w1:p2', cwd: '/tmp/demo', session: 'hwtest', lang: 'fr' })).toEqual([
      'adopt-workspace', '--name', 'Demo', '--pane', 'w1:p2', '--workspace-cwd', '/tmp/demo',
      '--goal', 'Faire X. Tâche en cours: corriger Y', '--session', 'hwtest',
    ])
    expect(projectCommandArgs('adopt-workspace', { name: 'Demo', goal: 'Do X.' }, { pane: 'w1:p2', cwd: '/tmp/demo', session: 'default' }))
      .toEqual(['adopt-workspace', '--name', 'Demo', '--pane', 'w1:p2', '--workspace-cwd', '/tmp/demo', '--goal', 'Do X.'])
    expect(() => projectCommandArgs('adopt-workspace', { name: 'Demo', goal: 'g' }, { session: 'default' })).toThrow()
  })

  it('adopt-workspace without a goal: no --goal, or the task alone', () => {
    const ctx = { pane: 'w1:p2', cwd: '/tmp/demo', session: 'default', lang: 'fr' as const }
    expect(projectCommandArgs('adopt-workspace', { name: 'Demo' }, ctx))
      .toEqual(['adopt-workspace', '--name', 'Demo', '--pane', 'w1:p2', '--workspace-cwd', '/tmp/demo'])
    expect(projectCommandArgs('adopt-workspace', { name: 'Demo', task: 'corriger Y' }, ctx))
      .toEqual(['adopt-workspace', '--name', 'Demo', '--pane', 'w1:p2', '--workspace-cwd', '/tmp/demo', '--goal', 'corriger Y'])
  })

  it('appends the task to the goal without doubling punctuation', () => {
    expect(goalWithTask('Do X', '')).toBe('Do X')
    expect(goalWithTask('Do X!', 'fix Y')).toBe('Do X! Current task: fix Y')
    expect(goalWithTask('', 'fix Y')).toBe('fix Y')
    expect(goalWithTask('', '')).toBe('')
  })

  it('builds new with --repo only if given', () => {
    expect(projectCommandArgs('new', { name: 'Demo', goal: 'g', repo: '/tmp/repo' }, { session: 'hwtest' }))
      .toEqual(['new', 'Demo', '--goal', 'g', '--repo', '/tmp/repo'])
    expect(projectCommandArgs('new', { name: 'Demo', goal: 'g' }, { session: 'default' })).toEqual(['new', 'Demo', '--goal', 'g'])
    expect(projectCommandArgs('new', { name: 'Demo' }, { session: 'default' })).toEqual(['new', 'Demo'])
    expect(projectCommandArgs('new', { name: 'Demo', repo: '/tmp/repo' }, { session: 'default' })).toEqual(['new', 'Demo', '--repo', '/tmp/repo'])
    expect(projectCommandArgs('open', { slug: 'demo' }, { session: 'hwtest' })).toEqual(['open', 'demo', '--session', 'hwtest'])
    expect(projectCommandArgs('pause', { slug: 'demo' }, { session: 'hwtest' })).toEqual(['pause', 'demo'])
    expect(projectCommandArgs('doctor', {}, { session: 'default' })).toEqual(['doctor'])
  })
})

describe('conversation vide avant adoption', () => {
  const item = (role: string, text = 'hello') => ({ role, text, ts: null }) as never
  it('vide : aucun message, ou transcription introuvable', () => {
    expect(conversationEmpty({ available: true, items: [] })).toBe(true)
    expect(conversationEmpty({ available: true, items: [item('system'), item('cmd'), item('user', '  ')] })).toBe(true)
    expect(conversationEmpty({ available: false, reason: 'not_found' })).toBe(true)
  })
  it('non-empty from one message; unknown if the agent is not readable', () => {
    expect(conversationEmpty({ available: true, items: [item('user')] })).toBe(false)
    expect(conversationEmpty({ available: true, items: [item('assistant')] })).toBe(false)
    expect(conversationEmpty({ available: false, reason: 'unsupported' })).toBeNull()
    expect(conversationEmpty(null)).toBeNull()
  })
})

describe('Check setup', () => {
  it('donne version, binaire, HOME et config Herdr, et signale un binaire hors du HOME', () => {
    expect(setupHeader({ version: 'herdr-projects 0.2.30+abc', binary: '/home/demo/.local/bin/herdr-projects', home: '/home/demo/' })).toEqual([
      { key: 'version', value: '0.2.30+abc', warn: false },
      { key: 'binary', value: '/home/demo/.local/bin/herdr-projects', warn: false },
      { key: 'home', value: '/home/demo', warn: false },
      { key: 'config', value: '/home/demo/.config/herdr/config.toml' },
    ])
    const other = setupHeader({ version: null, binary: '/opt/other/herdr-projects', home: '/home/demo' })
    expect(other.find(l => l.key === 'binary')!.warn).toBe(true)
    expect(other.find(l => l.key === 'version')).toEqual({ key: 'version', value: '?', warn: true })
  })
  it('recognizes the levels of doctor lines', () => {
    expect(doctorLevel('[ok  ] git: 2.50')).toBe('ok')
    expect(doctorLevel('[warn] ticker: not running')).toBe('warn')
    expect(doctorLevel('[FAIL] session: none')).toBe('fail')
    expect(doctorLevel('binary: /x')).toBeNull()
  })
})
