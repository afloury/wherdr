// WHR-202: a `wherdr` block's `task <ID>` lines, and the row a task shows as.
import { describe, expect, it } from 'vitest'
import { parseWherdrBlock } from '../app/utils/markdown'
import { taskRow, type Card } from '../shared/pm/board'

describe('wherdr blocks', () => {
  it('reads task lines, and leaves any block with a line it does not know as code', () => {
    expect(parseWherdrBlock('task WHR-12\n\n  task ACME-API-4  \n')).toEqual([{ kind: 'task', id: 'WHR-12' }, { kind: 'task', id: 'ACME-API-4' }])
    for (const text of ['', 'task', 'task WHR-12 extra', 'task WHR-12\nmerge WHR-12', 'task <b>-1']) expect(parseWherdrBlock(text)).toBeNull()
  })
})

describe('taskRow', () => {
  const card = (c: Partial<Card>) => ({ id: 'CO-4', shown: 'CO-4', project: 'co', title: 'Fix login', column: 'review', phase: 'working', holder: 'reviewer', ...c }) as Card
  it('says what to do in Your turn, else where the task stands and its column', () => {
    expect(taskRow(card({ yourTurn: 'Look at the screenshots\nmore', state: { yourTurn: { reason: 'user' } } as Card['state'], userLabel: 'Merge' })))
      .toMatchObject({ action: 'Look at the screenshots', label: 'Merge' })
    expect(taskRow(card({}))).toMatchObject({ action: 'Being reviewed', label: 'review' })
    expect(taskRow(card({ stopped: { by: 'user', why: 'paused', at: 1 } }))).toMatchObject({ action: 'Stopped: paused' })
    expect(taskRow(card({ phase: 'todo', column: 'To do', holder: 'none' }))).toMatchObject({ action: 'Not started yet', label: 'To do' })
  })
})
