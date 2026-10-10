// Messages the server gives back go into their pane's message field, on
// whatever screen the app shows (see utils/givenBack.ts).
import type { QueuedMessage } from '#shared/types'
import { createGivenBack } from '~/utils/givenBack'

export default defineNuxtPlugin(() => {
  const takeGivenBack = createGivenBack({
    take: async (paneId: string, q: QueuedMessage) => {
      const r = await api<{ text: string }>('/api/unqueue', { pane_id: paneId, text: q.text, id: q.id })
      outboxDrop(paneId, q.id)
      return r.text
    },
    draft: useDraft,
    done: (_paneId, n) => {
      toast(n > 1
        ? tl(`${n} unsent messages put back into the message field`, `${n} messages non envoyés remis dans le champ de saisie`)
        : tl('Unsent message put back into the message field', 'Message non envoyé remis dans le champ de saisie'))
    },
  })
  watch(herdrState, s => void takeGivenBack(s), { immediate: true })
})
