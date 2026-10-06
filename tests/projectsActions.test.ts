import { describe, expect, it } from 'vitest'
import { cleanProjectInput, conversationEmpty, doctorLevel, goalWithTask, parseProfileList, projectCommandArgs, roleProfiles, setupHeader } from '../shared/projectsActions'

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

  it('passes the chosen profiles to new, and refuses a profile read as an option', () => {
    const input = cleanProjectInput('new', { name: 'Demo', coordinatorProfile: 'omp', threadProfile: 'codex-fast' })!
    expect(projectCommandArgs('new', input, { session: 'default' }))
      .toEqual(['new', 'Demo', '--coordinator-profile', 'omp', '--thread-profile', 'codex-fast'])
    expect(cleanProjectInput('new', { name: 'Demo', coordinatorProfile: '' })).toEqual({ name: 'Demo' })
    expect(cleanProjectInput('new', { name: 'Demo', coordinatorProfile: '--yolo' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', threadProfile: '.hidden' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', threadProfile: 'a/b' })).toBeNull()
    expect(cleanProjectInput('new', { name: 'Demo', threadProfile: 'x'.repeat(41) })).toBeNull()
  })
})

describe('herdr-projects profiles for "New project"', () => {
  const list = (defaults: string, threads: string, coordinator: string) => [
    'Profiles (built-ins: the agent CLIs installed and signed in here: claude, omp):',
    '  luna           omp · default model — Cheap tier',
    '  a-very-long-profile-name codex · model gpt-5.5 · effort high',
    '  claude         claude · default model  (built-in)',
    '  omp            omp · default model  (built-in)',
    '',
    `Defaults for new projects: ${defaults}`,
    `Allowed for threads in projects without their own list: ${threads}`,
    `Allowed for the coordinator in projects without their own list: ${coordinator}`,
    '',
  ].join('\n')

  it('reads the verbatim output of herdr-projects 0.2.34', () => {
    const real = `Profiles (built-ins: the agent CLIs installed and signed in here: claude, omp, opencode):
  claude         claude · default model  (built-in)
  omp            omp · default model  (built-in)
  opencode       opencode · default model  (built-in)

Defaults for new projects: thread_profile = claude, coordinator_profile = claude
Allowed for threads in projects without their own list: every profile
Allowed for the coordinator in projects without their own list: every profile
`
    expect(parseProfileList(real)).toEqual({
      profiles: [{ name: 'claude', agent: 'claude' }, { name: 'omp', agent: 'omp' }, { name: 'opencode', agent: 'opencode' }],
      defaults: { thread: 'claude', coordinator: 'claude' },
      allowed: { thread: null, coordinator: null },
    })
  })

  it('reads the profiles with their harness, the defaults and the allow-lists', () => {
    const c = parseProfileList(list('thread_profile = luna, coordinator_profile = claude', 'every profile', 'claude, omp'))!
    expect(c.profiles).toEqual([
      { name: 'luna', agent: 'omp' }, { name: 'a-very-long-profile-name', agent: 'codex' },
      { name: 'claude', agent: 'claude' }, { name: 'omp', agent: 'omp' },
    ])
    expect(c.defaults).toEqual({ thread: 'luna', coordinator: 'claude' })
    expect(c.allowed).toEqual({ thread: null, coordinator: ['claude', 'omp'] })
    // An empty `[safety.default]` list prints as nothing: no profile allowed.
    expect(parseProfileList(list('thread_profile = claude, coordinator_profile = claude', '', 'every profile'))!.allowed.thread).toEqual([])
  })

  it('no choice from a plugin without profiles', () => {
    expect(parseProfileList('error: unrecognized subcommand \'profile\'\n')).toBeNull()
    expect(parseProfileList('')).toBeNull()
  })

  it('offers the allowed profiles, the default chosen only when allowed', () => {
    const c = parseProfileList(list('thread_profile = luna, coordinator_profile = claude', 'every profile', 'omp, luna'))!
    expect(roleProfiles(c, 'thread')).toEqual({ list: c.profiles, chosen: 'luna' })
    expect(roleProfiles(c, 'coordinator')).toEqual({ list: [{ name: 'luna', agent: 'omp' }, { name: 'omp', agent: 'omp' }], chosen: 'luna' })
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
