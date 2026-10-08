// App windows (sheets at the bottom on the phone, centered windows on a
// computer): menus, new agent, rename, command result, image
// preview, confirmation.
import { parseMenu } from '../../shared/menuScreen'
import { agentAnswering, ompSelectorOnScreen } from '../../shared/commandScreen'

export interface MenuItem {
  kind?: 'action' | 'command' | 'separator' | 'note' | 'group'
  label?: string
  icon?: string
  danger?: boolean
  cmd?: string
  // Command: its description; action: line under the label.
  desc?: string
  // Line under the label in mono font (an ID…).
  mono?: boolean
  // Keyboard shortcut (computer dropdown menus), Nuxt UI keys.
  kbds?: string[]
  run?: () => void
}

export const menuState = reactive<{ open: boolean, items: MenuItem[], title?: string }>({ open: false, items: [] })
export function openMenu(items: MenuItem[], title?: string) {
  menuState.items = items
  menuState.title = title
  menuState.open = true
}
// Phone: access to Settings from a view's menu (on a computer, the
// sidebar already offers them). Back returns to that view.
export function settingsMenuItems(): MenuItem[] {
  if (desk.value) return []
  return [{ kind: 'separator' }, { label: t('Settings'), icon: 'i-lucide-settings-2', run: () => navigateTo('/settings') }]
}

export const newAgentOpen = ref(false)
export const renameTarget = ref<string | null>(null)

// Result of a local command (/context…), read from the terminal screen.
// Claude Code's settings panel (/usage, /status, /config, /stats): `tabs` as
// drawn on screen (they vary between versions), `tab` the active one.
export const commandResult = reactive<{ open: boolean, pane: string | null, cmd: string, text: string | null, tabs: string[], tab: string | null }>({
  open: false, pane: null, cmd: '', text: null, tabs: [], tab: null,
})

export const lightboxSrc = ref<string | null>(null)
// Images of the same message, browsable in the viewer (← →, swipe).
export const lightboxSet = ref<string[]>([])
export function openLightbox(srcs: string[], index = 0) {
  lightboxSet.value = srcs
  lightboxSrc.value = srcs[index] ?? null
}

// `tone`: red action button (destructive, the default) or accent. `code`:
// shown in full under the message, in a code box (a command to run).
export const confirmState = reactive<{ open: boolean, message: string, code: string, action: string, tone: 'error' | 'primary', resolve: ((ok: boolean) => void) | null }>({
  open: false, message: '', code: '', action: '', tone: 'error', resolve: null,
})
export function askConfirm(message: string, action: string, tone: 'error' | 'primary' = 'error', code = ''): Promise<boolean> {
  confirmState.resolve?.(false)
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.code = code
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

// A window is open: Escape closes it instead of acting elsewhere.
export const anySheetOpen = computed(() => menuState.open || newAgentOpen.value || Boolean(renameTarget.value) || Boolean(renameSpace.value)
  || commandResult.open || confirmState.open || pluginFormState.open || Boolean(lightboxSrc.value))

// Local commands leave no trace in the transcript: we
// show what they displayed, extracted from the terminal screen.
// `builtin`: built-in agent command, panel opened right away (it
// loads); otherwise (command unknown to the catalog) it only opens once
// the screen is read, if it is neither a menu nor the agent working.
let resultSeq = 0
export async function showCommandResult(pane: string, cmd: string, builtin = true) {
  const seq = ++resultSeq
  commandResult.pane = pane
  commandResult.cmd = cmd
  commandResult.text = null
  commandResult.tabs = []
  commandResult.tab = null
  commandResult.open = builtin
  await new Promise(r => setTimeout(r, 1800))
  if (seq !== resultSeq) return
  await readCommandResult(pane, cmd, 5, seq)
}

// Reads the screen and extracts the result; re-reads while the panel loads
// ("Loading…": the /usage gauges arrive after a moment).
async function readCommandResult(pane: string, cmd: string, tries = 5, seq = resultSeq) {
  const current = () => seq === resultSeq && commandResult.pane === pane && commandResult.cmd === cmd
    && (commandResult.open || commandResult.text === null)
  for (let i = 0; i < tries && current(); i++) {
    try {
      const { text, tabs, tab } = await api<{ text: string, tabs: string[] | null, tab: string | null }>(`/api/screen?pane=${encodeURIComponent(pane)}`)
      if (!current()) return
      // Interactive menu (/resume, /model…): not an output, it is driven in the conversation.
      // Skill, custom command, /compact…: the agent is working, the
      // conversation shows it; Escape would interrupt it.
      // omp draws no recognizable activity under the command: its state wins.
      const p = herdrState.value.panes.find(x => x.id === pane)
      const working = p?.agent === 'omp' && p.status === 'working'
      if (parseMenu(text) || ompSelectorOnScreen(text) || agentAnswering(text, cmd) || working) { closeCommandResult(false); return }
      const shown = extractResult(text, cmd)
      // "Loading…" (/usage gauges), "⏳ Waiting for response…" (omp's /btw).
      const loading = /\bLoading\b|Waiting for response/.test(shown)
      if (loading && i < tries - 1) { await new Promise(r => setTimeout(r, 1200)); continue }
      commandResult.tabs = tabs || []
      commandResult.tab = tab
      commandResult.text = shown || t('Nothing displayed — check the Terminal tab.')
      commandResult.open = true
      return
    } catch (err) {
      commandResult.text = (err as Error).message
      commandResult.open = true
      return
    }
  }
}

// Switch tabs in the panel: ← → arrows in the terminal, then re-read.
export async function switchCommandTab(target: string) {
  const pane = commandResult.pane
  const from = commandResult.tabs.indexOf(commandResult.tab || '')
  const to = commandResult.tabs.indexOf(target)
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
// When closing the result, we also close the panel on the agent side (/usage…),
// otherwise it stays open and swallows the following messages.
// `dismiss`: Escape sent to the terminal to close the command's panel;
// never for an interactive menu (Escape would cancel it).
export function closeCommandResult(dismiss = true) {
  resultSeq++
  if (!commandResult.open) return
  commandResult.open = false
  const pane = commandResult.pane
  if (pane && dismiss) api('/api/dismiss', { pane_id: pane }).catch(() => {})
}

// Same entries as a dropdown menu (computer): separate groups, destructive
// actions in red, notes ignored.
export function toDropdown(items: MenuItem[]) {
  const groups: { label?: string, description?: string, icon?: string, color?: 'error', kbds?: string[], ui?: { itemDescription: string }, onSelect: () => void }[][] = [[]]
  for (const it of items) {
    if (it.kind === 'separator' || it.kind === 'group') groups.push([])
    else if (it.kind === 'note') continue
    else {
      groups[groups.length - 1]!.push({
        label: it.kind === 'command' ? `${it.cmd}  ${it.desc}` : it.label,
        ...(it.kind !== 'command' && it.desc ? { description: it.desc } : {}),
        ...(it.mono ? { ui: { itemDescription: 'font-mono' } } : {}),
        icon: it.icon,
        color: it.danger ? 'error' : undefined,
        kbds: it.kbds,
        onSelect: () => it.run?.(),
      })
    }
  }
  return groups.filter(g => g.length)
}
