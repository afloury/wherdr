// Brouillons du champ de saisie, un par conversation : le texte et les photos
// jointes restent quand on change de conversation, et même après un
// rechargement de l'app (localStorage). Les photos sont déjà déposées sur le
// serveur : on garde leur chemin (envoyé avec le message) et leur nom (aperçu
// via /uploads/<nom>).

import { effectScope, reactive, watch } from 'vue'

export interface DraftAtt {
  url: string // aperçu : blob local tant que la page vit, sinon /uploads/<nom>
  path: string | null // null pendant l'envoi de la photo
  name?: string
}
interface Draft { text: string, atts: DraftAtt[] }

const KEY = 'draft:'
// Les photos déposées sont purgées au bout de 7 jours : on les oublie avant.
const ATT_MAX_AGE = 6 * 86400000
const drafts = new Map<string, Draft>()
// Les brouillons survivent au composant : leurs watchers ne lui appartiennent pas.
const scope = effectScope(true)

// Date de dépôt d'une photo, lue dans son nom (2026-09-26T00-36-39-393Z-4fa305.jpg).
export function uploadedAt(name: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0
}

function load(paneId: string): Draft {
  try {
    const raw = localStorage.getItem(KEY + paneId)
    if (raw) {
      const d = JSON.parse(raw) as { text?: string, atts?: { path: string, name?: string }[] }
      return {
        text: d.text || '',
        atts: (d.atts || [])
          .filter(a => a.path && a.name && Date.now() - uploadedAt(a.name) < ATT_MAX_AGE)
          .map(a => ({ url: `/uploads/${encodeURIComponent(a.name!)}`, path: a.path, name: a.name })),
      }
    }
  } catch { /* stockage indisponible ou brouillon illisible */ }
  return { text: '', atts: [] }
}

function persist(paneId: string, d: Draft) {
  const atts = d.atts.filter(a => a.path && a.name).map(a => ({ path: a.path, name: a.name }))
  try {
    if (!d.text && !atts.length) localStorage.removeItem(KEY + paneId)
    else localStorage.setItem(KEY + paneId, JSON.stringify({ text: d.text, atts }))
  } catch { /* stockage indisponible */ }
}

// Brouillon réactif du pane : le même objet tant que la page vit, donc une
// photo qui finit de s'envoyer après un changement de conversation y arrive.
export function useDraft(paneId: string): Draft {
  let d = drafts.get(paneId)
  if (!d) {
    d = reactive(load(paneId)) as Draft
    drafts.set(paneId, d)
    const draft = d
    scope.run(() => watch(() => [draft.text, draft.atts.map(a => a.path).join('|')], () => persist(paneId, draft)))
  }
  return d
}
