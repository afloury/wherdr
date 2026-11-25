import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readChecklist, updateChecklist } from '../server/utils/checklistStore'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'checklist-'))
  file = path.join(dir, 'checklists.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const items = [
  { index: 0, group: 1, text: 'a', written: false },
  { index: 1, group: 1, text: 'b', written: false },
]
const toggle = (index: number, checked: boolean, key = 'k') => ({ op: 'toggle', key, at: 7, items, index, checked })

describe('checklist store', () => {
  it('is empty without a file', async () => {
    expect(await readChecklist('p1', file)).toEqual({})
  })

  it('persists across a fresh read and marks sent', async () => {
    const s = await updateChecklist('p1', toggle(0, true), file)
    expect(s.k.items['0'].checked).toBe(true)
    expect((await readChecklist('p1', file)).k.items['0']).toMatchObject({ checked: true, sent: false })
    expect(await readChecklist('p2', file)).toEqual({})
    const sent = await updateChecklist('p1', { op: 'sent', marks: [{ key: 'k', index: 0, value: true }] }, file)
    expect(sent.k.items['0'].sent).toBe(true)
    expect((await readChecklist('p1', file)).k.items['0'].sent).toBe(true)
  })

  it('serialises concurrent updates', async () => {
    await Promise.all([updateChecklist('p1', toggle(0, true), file), updateChecklist('p1', toggle(1, true), file), updateChecklist('p2', toggle(0, true), file)])
    const s = await readChecklist('p1', file)
    expect(s.k.items['0'].checked && s.k.items['1'].checked).toBe(true)
    expect((await readChecklist('p2', file)).k.items['0'].checked).toBe(true)
  })

  it('refuses bad input', async () => {
    await expect(updateChecklist('p1', { op: 'nope' }, file)).rejects.toMatchObject({ code: 'bad_input' })
    await expect(updateChecklist('p1', { ...toggle(0, true), items: 'x' }, file)).rejects.toMatchObject({ code: 'bad_input' })
    await expect(updateChecklist('p1', { op: 'sent', marks: [{ key: 'k' }] }, file)).rejects.toMatchObject({ code: 'bad_input' })
    await expect(updateChecklist('', toggle(0, true), file)).rejects.toMatchObject({ code: 'bad_input' })
  })

  it('keeps at most 200 conversations, dropping the least recently updated', async () => {
    for (let i = 0; i < 201; i++) await updateChecklist(`p${i}`, toggle(0, true), file)
    expect(await readChecklist('p0', file)).toEqual({})
    expect((await readChecklist('p200', file)).k).toBeDefined()
    expect((await readChecklist('p1', file)).k).toBeDefined()
  })
})
