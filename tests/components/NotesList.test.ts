import { afterEach, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import NotesList from '~/components/NotesList.vue'
import { notes, notesFilter } from '~/composables/useNotes'
import { machineBarSaved, machineGroups } from '~/composables/useMachineBar'
import { NOTES_FOLLOW, type Note } from '#shared/notes'
import { pick } from '../helpers/select'

const note = (id: string, scope: string, body: string): Note => ({ id, title: id, scope, body, created: '', updated: '' })
afterEach(() => { notes.value = null; notesFilter.value = NOTES_FOLLOW; machineGroups.value = []; machineBarSaved.value = null })

it('follows the group tab, renders badges and keeps checkboxes read-only', async () => {
  machineGroups.value = [{ id: 'g1', name: 'Work', machines: ['host-a'] }, { id: 'g2', name: 'Home', machines: ['host-b'] }]
  machineBarSaved.value = 'g1'
  notes.value = [
    note('everywhere', 'all', '- [ ] Review [[WHR-12]]\n- [x] Ship it'),
    note('work', 'g1', 'Waiting on [[Design|clock|amber]] in `[[not-a-badge]]`'),
    note('home', 'g2', 'Water the plants'),
  ]
  const w = await mountSuspended(NotesList)
  await nextTick()
  const titles = () => w.findAll('[data-testid=note] h3 span').map(x => x.text())
  expect(titles()).toEqual(['everywhere', 'work'])

  const badges = w.findAll('[data-testid=note-badge]')
  expect(badges.map(b => b.text())).toEqual(['WHR-12', 'Design'])
  expect(badges[0]!.attributes('href')).toBe('#/board?task=WHR-12')
  expect(w.find('#note-work code').text()).toBe('[[not-a-badge]]')

  const box = w.find('#note-everywhere input[type=checkbox]')
  expect(box.attributes('disabled')).toBeDefined()
  await box.trigger('click')
  expect((box.element as HTMLInputElement).checked).toBe(false)

  machineBarSaved.value = 'g2' // the home tab changes: the notes follow
  await nextTick()
  expect(titles()).toEqual(['everywhere', 'home'])
  await pick(w, 'notes-filter', 'all')
  expect(titles()).toEqual(['everywhere', 'work', 'home'])
  w.unmount()
})
