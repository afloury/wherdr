// Fenêtres de l'app (feuilles en bas sur téléphone, fenêtres centrées sur
// ordinateur) : menus, nouvel agent, renommer, résultat de commande, aperçu
// d'image, confirmation.

export interface MenuItem {
  kind?: 'action' | 'command' | 'separator' | 'note' | 'group'
  label?: string
  icon?: string
  danger?: boolean
  cmd?: string
  // Commande : sa description ; action : ligne sous le libellé.
  desc?: string
  // Raccourci clavier (menus déroulants de l'ordinateur), touches Nuxt UI.
  kbds?: string[]
  run?: () => void
}

export const menuState = reactive<{ open: boolean, items: MenuItem[], title?: string }>({ open: false, items: [] })
export function openMenu(items: MenuItem[], title?: string) {
  menuState.items = items
  menuState.title = title
  menuState.open = true
}
// Téléphone : accès aux Réglages depuis le menu d'une vue (sur ordinateur, la
// barre latérale les propose déjà). Le retour ramène à cette vue.
export function settingsMenuItems(): MenuItem[] {
  if (desk.value) return []
  return [{ kind: 'separator' }, { label: t('Réglages'), icon: 'i-lucide-settings-2', run: () => navigateTo('/settings') }]
}

export const newAgentOpen = ref(false)
export const renameTarget = ref<string | null>(null)

// Résultat d'une commande locale (/context…), lu sur l'écran du terminal.
export const commandResult = reactive<{ open: boolean, pane: string | null, cmd: string, text: string | null, tab: string | null }>({
  open: false, pane: null, cmd: '', text: null, tab: null,
})
// Onglets du panneau de réglages de Claude Code (/usage, /status, /config, /stats).
export const SETTINGS_TABS = ['Status', 'Config', 'Usage', 'Stats']

export const lightboxSrc = ref<string | null>(null)

// `tone` : bouton d'action rouge (destructrice, par défaut) ou d'accent.
export const confirmState = reactive<{ open: boolean, message: string, action: string, tone: 'error' | 'primary', resolve: ((ok: boolean) => void) | null }>({
  open: false, message: '', action: '', tone: 'error', resolve: null,
})
export function askConfirm(message: string, action: string, tone: 'error' | 'primary' = 'error'): Promise<boolean> {
  confirmState.resolve?.(false)
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.action = action
    confirmState.tone = tone
    confirmState.resolve = resolve
    confirmState.open = true
  })
}
export function answerConfirm(ok: boolean) {
  const r = confirmState.resolve
  confirmState.resolve = null
  confirmState.open = false
  r?.(ok)
}

// Une fenêtre est ouverte : Échap la ferme au lieu d'agir ailleurs.
export const anySheetOpen = computed(() => menuState.open || newAgentOpen.value || Boolean(renameTarget.value) || Boolean(renameSpace.value)
  || commandResult.open || confirmState.open || Boolean(lightboxSrc.value))

// Les commandes locales ne laissent pas de trace dans la transcription : on
// montre ce qu'elles ont affiché, extrait de l'écran du terminal.
export async function showCommandResult(pane: string, cmd: string) {
  commandResult.pane = pane
  commandResult.cmd = cmd
  commandResult.text = null
  commandResult.tab = null
  commandResult.open = true
  await new Promise(r => setTimeout(r, 1800))
  await readCommandResult(pane, cmd)
}

// Lit l'écran et en extrait le résultat ; relit tant que le panneau charge
// (« Loading… » : les jauges de /usage arrivent après un instant).
async function readCommandResult(pane: string, cmd: string, tries = 5) {
  const current = () => commandResult.open && commandResult.pane === pane && commandResult.cmd === cmd
  for (let i = 0; i < tries && current(); i++) {
    try {
      const { text, tab } = await api<{ text: string, tab: string | null }>(`/api/screen?pane=${encodeURIComponent(pane)}`)
      if (!current()) return
      const shown = extractResult(text, cmd)
      const loading = /\bLoading\b/.test(shown)
      if (loading && i < tries - 1) { await new Promise(r => setTimeout(r, 1200)); continue }
      commandResult.tab = tab
      commandResult.text = shown || t('Rien d’affiché — regarde l’onglet Terminal.')
      return
    } catch (err) {
      commandResult.text = (err as Error).message
      return
    }
  }
}

// Le résultat dans l'écran : sous la ligne de la commande, ou le panneau de
// réglages de Claude Code en entier (il remplace la ligne de commande), sinon
// le bas de l'écran.
export function extractResult(text: string, cmd: string) {
  const lines = text.replace(/\s+$/, '').split('\n')
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    // « ❯ /usage » (Claude), ou la commande seule sur sa ligne (Codex).
    if (lines[i]!.includes(cmd) && (/^\s*[❯›>]/.test(lines[i]!) || lines[i]!.trim() === cmd)) {
      start = i + 1
      break
    }
  }
  if (start < 0) start = lines.findIndex(l => /^\s*Settings\s+Status\s+Config\b/.test(l))
  let out = start >= 0 ? lines.slice(start) : lines.slice(-30)
  // Encadré juste sous la commande (Codex) : son contenu, sans ce qui suit.
  const top = out.findIndex(l => l.trim())
  if (top >= 0 && /^\s*[╭┌]/.test(out[top]!)) {
    const end = out.findIndex((l, i) => i > top && /^\s*[╰└]/.test(l))
    out = unbox(out.slice(top, end > 0 ? end + 1 : undefined))
  }
  const rule = out.findIndex(l => /^[\s─━]{20,}$/.test(l))
  if (rule > 0) out = out.slice(0, rule)
  // Indicateur de défilement du panneau (« ↓ », « ↓ stats ») en bout de ligne.
  out = out.map(l => l.replace(/\s{2,}↓(\s+\w+)?\s*$/, ''))
  return out.join('\n').replace(/^\s*⎿\s?/m, '').replace(/\n{3,}/g, '\n\n').trim()
}

// Changer d'onglet dans le panneau : flèches ← → dans le terminal, puis relecture.
export async function switchCommandTab(target: string) {
  const pane = commandResult.pane
  const from = SETTINGS_TABS.indexOf(commandResult.tab || '')
  const to = SETTINGS_TABS.indexOf(target)
  if (!pane || from < 0 || to < 0 || from === to) return
  const n = to - from
  commandResult.tab = target
  commandResult.text = null
  try {
    await api('/api/input', { pane_id: pane, keys: Array(Math.abs(n)).fill(n > 0 ? 'right' : 'left') })
  } catch (err) {
    commandResult.text = (err as Error).message
    return
  }
  await new Promise(r => setTimeout(r, 900))
  await readCommandResult(pane, commandResult.cmd, 8)
}
// En refermant le résultat, on referme aussi le panneau côté agent (/usage…),
// sinon il reste ouvert et avale les messages suivants.
export function closeCommandResult() {
  if (!commandResult.open) return
  commandResult.open = false
  const pane = commandResult.pane
  if (pane) api('/api/dismiss', { pane_id: pane }).catch(() => {})
}

// Mêmes entrées en menu déroulant (ordinateur) : groupes séparés, actions
// destructrices en rouge, notes ignorées.
export function toDropdown(items: MenuItem[]) {
  const groups: { label?: string, icon?: string, color?: 'error', kbds?: string[], onSelect: () => void }[][] = [[]]
  for (const it of items) {
    if (it.kind === 'separator' || it.kind === 'group') groups.push([])
    else if (it.kind === 'note') continue
    else {
      groups[groups.length - 1]!.push({
        label: it.kind === 'command' ? `${it.cmd}  ${it.desc}` : it.label,
        icon: it.icon,
        color: it.danger ? 'error' : undefined,
        kbds: it.kbds,
        onSelect: () => it.run?.(),
      })
    }
  }
  return groups.filter(g => g.length)
}
