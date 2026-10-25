import type { Pane, QueuedMessage } from '../../shared/types'

export function queueReason(p: Pane, q: Pick<QueuedMessage, 'reason'>): 'busy' | 'stopped' | 'question' | 'dialog' | 'starting' | 'working' | 'sending' {
  if (p.stopped || !p.agent) return 'stopped'
  if (p.prompt) return 'question'
  if (p.menu || p.screen || p.menuLeftOpen) return 'dialog'
  if (p.status === 'blocked') return 'question'
  if (p.pendingPrompt) return 'starting'
  if (p.status === 'working') return 'working'
  if (q.reason === 'busy') return 'busy'
  return 'sending'
}
export function canClearQueued(p: Pane, q: { reason?: QueuedMessage['reason'], state?: string | null }): boolean {
  return p.agent === 'claude' && ['idle', 'done'].includes(p.status || '') && !p.leaving
    && q.state === 'held' && queueReason(p, q) === 'busy'
}
