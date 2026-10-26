import { type BoardCard, type Member, type MemberStage, memberStage, memberTag } from '#shared/boardLinks'
import { memberGroup } from '~/utils/projectSummary'

function stageLabel(s: MemberStage): string {
  if (s.what === 'attempts') return tl(`${s.n} attempts`, `${s.n} essais`)
  const what = {
    'review': tl('Under review', 'En relecture'),
    'plan-review': tl('Plan review', 'Revue du plan'),
    'pick': tl('Comparing attempts', 'Comparaison des essais'),
    'planning': tl('Planning', 'Plan en cours'),
  }[s.what]
  return what
}
export function memberCard(m: Member): BoardCard | null {
  if (!m.task) return null
  const task = m.task
  const stage = memberStage(m)
  const worker = task.panes.find(p => p.role === 'worker')
  const workerPane = m.row.kind === 'space'
    ? m.row.panes.find(p => p.id === worker?.id)
    : m.role === 'worker' && !m.focus ? m.row.lead : null
  return {
    identity: m.role === 'attempt' ? { agent: m.row.lead.agent || '', reviewer: '', from: '' } : {
      agent: task.identity?.agent || worker?.kind || workerPane?.agent || '',
      reviewer: task.identity?.reviewer || (m.focus?.role === 'reviewer' ? m.focus.kind : ''),
      from: task.identity?.from || '',
    },
    group: memberGroup(m) || undefined,
    // From the task's own stage and message (linksFromTaskFile), not a kept watcher's line.
    activity: memberGroup(m) === 'working' ? task.activity ?? null : null,
    tag: memberTag(m, t('review')),
    stage: stage && ['review', 'plan-review', 'pick'].includes(stage.what) ? stageLabel(stage) : undefined,
    // While a helper works, its tab (the row's pane's) opens, not the one opened last.
    tab: m.focus && m.row.kind === 'space' ? m.row.leadTab.tab.id : undefined,
    name: task.title || undefined,
    progress: task.progress,
    since: task.since,
    msg: task.msg,
    // The task it belongs to: selected while the Board's panel shows it.
    taskRef: { machine: m.board || '', id: task.id },
    onBoard: () => navigateTo({ path: '/board', query: { machine: m.board || '', task: task.id, now: '1' } }),
  }
}
