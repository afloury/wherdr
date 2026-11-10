import { expect, it } from 'vitest'
import { proposalSpot, type PlacedBlock } from '../app/utils/proposalPlace'

const opens = (b: PlacedBlock) => b.k === 'user' || b.k === 'wake'
// The user asks for a change; the coordinator answers, runs `template edit` at
// 25, says it proposed it; later the user asks something else and gets a list of ideas.
const chat: PlacedBlock[] = [
  { k: 'user', key: 'u1', ms: 10 },
  { k: 'assistant', key: 'a1', ms: 20 },
  { k: 'tools', key: 't1' },
  { k: 'assistant', key: 'a2', ms: 30 },
  { k: 'user', key: 'u2', ms: 40 },
  { k: 'assistant', key: 'ideas', ms: 50 },
]

it('goes under the last reply of the turn that proposed it, never a later turn', () => {
  expect(proposalSpot(chat, 25, opens)).toBe('a2')
  // Its turn's text all came before the command: still that turn.
  expect(proposalSpot(chat.filter(b => b.key !== 'a2'), 25, opens)).toBe('a1')
  // A turn with no reply: the conversation's end while it is the last, else nowhere.
  expect(proposalSpot(chat.slice(0, 3).filter(b => b.k !== 'assistant'), 25, opens)).toBe('')
  expect(proposalSpot([{ k: 'user', key: 'u1', ms: 10 }, { k: 'tools', key: 't1' }, ...chat.slice(4)], 25, opens)).toBeNull()
  // A later command without a time ("!" or "/") does not move it.
  expect(proposalSpot([...chat, { k: 'shell', key: 's1' }, { k: 'assistant', key: 'later', ms: 60 }], 25, b => opens(b) || b.k === 'shell')).toBe('a2')
  expect(proposalSpot([...chat, { k: 'system', key: 'cmd' }], 25, b => opens(b) || b.k === 'system')).toBe('a2')
  // Its turn not loaded yet.
  expect(proposalSpot(chat.slice(4), 25, opens)).toBeNull()
})
