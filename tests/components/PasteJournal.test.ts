import { afterEach, expect, it } from 'vitest'
import { pasteJournal, pasteJournalEnabled, setPasteJournal, tracePaste } from '~/utils/pasteJournal'

const settle = () => new Promise(r => setTimeout(r, 10))
afterEach(() => { setPasteJournal(false) })
it('is opt-in, bounded, metadata only, and cleared when disabled', async () => {
  const field = document.createElement('textarea')
  document.body.append(field)
  field.focus()
  const e = new Event('paste', { cancelable: true })
  expect(pasteJournalEnabled.value).toBe(false)
  tracePaste(e, null, 12, field, () => 0)
  await settle()
  expect(pasteJournal.value).toEqual([])
  setPasteJournal(true)
  for (let i = 0; i < 55; i++) tracePaste(e, null, 12, field, () => 0)
  e.preventDefault()
  field.value = 'Private text'
  await settle()
  expect(pasteJournal.value).toHaveLength(50)
  expect(pasteJournal.value[0]).toMatchObject({ event: 'paste', textLength: 12, prevented: true, fieldFocused: true, modified: true, fieldLength: 12 })
  expect(JSON.stringify(pasteJournal.value)).not.toContain('Private text')
  setPasteJournal(false)
  expect(pasteJournal.value).toEqual([])
  field.remove()
})
