// UI targets: the settings an in-app link can point at with `&target=<id>`.
// The single list: each entry holds the address that opens its section (and
// tab), so the target is rendered first; the element carries
// `data-ui-target="<id>"` (a separate attribute from the plugins' frozen
// `data-wherdr`), and Settings scrolls to it and highlights it (SettingsView.vue,
// utils/uiHalo.ts). Internal for now: the agents' list of places
// (appLinks.ts appLinkList) does not offer them yet.
export const UI_TARGETS = {
  'appearance.theme': { link: '#/settings?section=appearance', label: 'Appearance › Theme' },
  'appearance.home-screen': { link: '#/settings?section=appearance', label: 'Appearance › Home screen' },
  'appearance.quotas': { link: '#/settings?section=appearance', label: 'Appearance › Quotas' },
  'conversation.default-pane': { link: '#/settings?section=conversation&tab=display', label: 'Conversation › Default pane view' },
  'conversation.typewriter': { link: '#/settings?section=conversation&tab=display', label: 'Conversation › Typewriter' },
  'conversation.reply-style': { link: '#/settings?section=conversation&tab=display', label: 'Conversation › Reply style' },
  'conversation.dictation': { link: '#/settings?section=conversation&tab=dictation', label: 'Conversation › Dictation' },
  'conversation.read-aloud': { link: '#/settings?section=conversation&tab=read-aloud', label: 'Conversation › Read aloud' },
  'terminal.text-size': { link: '#/settings?section=terminal', label: 'Terminal › Text size' },
  'terminal.rendering': { link: '#/settings?section=terminal', label: 'Terminal › Rendering' },
  'terminal.key-order': { link: '#/settings?section=terminal', label: 'Terminal › Phone key bar' },
  'agents.claude-quotas': { link: '#/settings?section=agents', label: 'Agents › Claude quotas' },
  'agents.pace': { link: '#/settings?section=agents', label: 'Agents › Pace' },
  'notifications.do-not-disturb': { link: '#/settings?section=notifications', label: 'Notifications › Do not disturb' },
  'notifications.device': { link: '#/settings?section=notifications', label: 'Notifications › This device' },
  'phone.app-start': { link: '#/settings?section=phone', label: 'Phone › App start' },
  'security.passkey': { link: '#/settings?section=security', label: 'Security › Passkey' },
} as const satisfies Record<string, { link: string, label: string }>
export type UiTargetId = keyof typeof UI_TARGETS

export const uiTarget = (id: unknown): UiTargetId | null =>
  typeof id === 'string' && Object.hasOwn(UI_TARGETS, id) ? id as UiTargetId : null

// The in-app address that opens a target's place and highlights it.
export const uiTargetLink = (id: UiTargetId) => `${UI_TARGETS[id].link}&target=${id}`

// The target's own name, without its section: "Theme".
export const uiTargetName = (id: UiTargetId) => UI_TARGETS[id].label.split(' › ').pop()!
