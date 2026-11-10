// Where a coordinator's workflow change card goes in its conversation: under
// the last reply of the turn that proposed it (the turn that ran `template
// edit`), never a later one. A turn starts at a message from the user or a
// wake (`opens`) and runs to the next one. `at`: when it was proposed.
// Returns that reply's key; '' for the conversation's end (its turn has no
// reply yet and is the last); null when its turn is not in view.
export interface PlacedBlock { k: string, key: string, ms?: number }

export function proposalSpot(blocks: PlacedBlock[], at: number, opens: (b: PlacedBlock) => boolean): string | null {
  const start = blocks.findLastIndex(b => opens(b) && (b.ms ?? 0) <= at)
  // Its turn is older than the first one loaded.
  if (start < 0 && blocks.some(opens)) return null
  const next = blocks.findIndex((b, i) => i > start && opens(b))
  const end = next < 0 ? blocks.length : next
  const reply = blocks.slice(start + 1, end).findLast(b => b.k === 'assistant')
  if (reply) return reply.key
  return end === blocks.length ? '' : null
}
