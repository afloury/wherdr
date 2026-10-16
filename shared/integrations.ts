// Herdr's agent integrations (`herdr integration install claude|codex|omp`):
// hooks that report each agent's session to Herdr (`agent_session` of
// `herdr pane list`). Without one, wherdr can only guess a Codex conversation
// (folder and start time), finds a Claude one through its process, and never
// finds an omp one.

export type IntegrationState = 'installed' | 'outdated' | 'missing'
export type IntegrationStatus = Record<string, IntegrationState>

// `herdr integration status` (Herdr 0.9):
//   codex: current (v8) (/home/u/.codex/herdr-agent-state.sh)
//   pi: not installed (/home/u/.pi/agent/extensions/herdr-agent-state.ts)
// Anything installed but not "current" (outdated, modified…) counts as outdated.
export function parseIntegrationStatus(text: string): IntegrationStatus {
  const out: IntegrationStatus = {}
  for (const line of String(text || '').split('\n')) {
    // Each agent line ends with the integration's file, in parentheses.
    const m = /^\s*([a-z][\w-]*):\s+(.+?)\s+\((?:\/|~|[A-Z]:\\)[^()]*\)\s*$/i.exec(line)
    if (!m) continue
    const state = m[2]!.toLowerCase()
    out[m[1]!.toLowerCase()] = state.startsWith('not installed') ? 'missing' : state.startsWith('current') ? 'installed' : 'outdated'
  }
  return out
}

export const integrationCommand = (agent: string) => `herdr integration install ${agent}`

// Statuses that show the agent already took a prompt (Herdr's own detection,
// which works without the integration): it then has a conversation.
const ACTIVE = new Set(['working', 'blocked', 'done'])
export const activeStatus = (status: string | null | undefined) => ACTIVE.has(String(status || ''))

// "No conversation" is blamed on a missing integration only when it is the
// likely cause: no session reported, the integration of that agent reported
// missing on its machine, and an agent that is not brand new — seen at work, or
// already running when wherdr started (`bornAt` unknown). A fresh agent that
// has not been asked anything keeps the plain "No conversation yet".
export function missingIntegration(p: { agent: string | null, agentSession?: string | null, bornAt?: number | null }, status: IntegrationStatus | null, wasActive: boolean): boolean {
  if (!p.agent || p.agentSession || !status) return false
  if (status[p.agent] !== 'missing') return false
  return wasActive || !p.bornAt
}

// Agents seen at work since they appeared in their pane (Herdr's status),
// by pane: another agent kind in the pane starts over.
export function createActivity() {
  const active = new Map<string, string>()
  return {
    observe(p: { id: string, agent: string | null, status: string | null }) {
      if (!p.agent) { active.delete(p.id); return }
      if (active.get(p.id) !== p.agent) active.delete(p.id)
      if (activeStatus(p.status)) active.set(p.id, p.agent)
    },
    was: (id: string, agent: string | null) => Boolean(agent) && active.get(id) === agent,
    prune(keep: (id: string) => boolean) {
      for (const id of active.keys()) if (!keep(id)) active.delete(id)
    },
  }
}
