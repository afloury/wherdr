// Agents seen at work, by pane (see transcripts.ts).

// Statuses that show the agent already took a prompt (Herdr's own detection,
// which works without the integration): it then has a conversation.
const ACTIVE = new Set(['working', 'blocked', 'done'])
const activeStatus = (status: string | null | undefined) => ACTIVE.has(String(status || ''))

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
