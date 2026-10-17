// Which layout the app uses for a window size.
// - phone: one view at a time (list, then agent).
// - computer ("desk"): list as a sidebar, agent on the right. From 900 px
//   wide, and also on a tablet in portrait (at least 700 × 700: iPad mini
//   744 × 1133, iPad Air 820 × 1180). A phone in landscape stays a phone.
// - slim: a computer layout narrower than 1024 px (tablet in portrait). The
//   list stays a narrow column and slides over the agent when opened, so the
//   conversation keeps the full width.
// The CSS uses the same queries (app/assets/css/main.css): keep them in sync.
export const DESK_QUERY = '(min-width: 900px), (min-width: 700px) and (min-height: 700px)'
export const PHONE_QUERY = '(max-width: 699px), (max-width: 899px) and (max-height: 699px)'
export const SLIM_MAX = 1023

export function isDesk(width: number, height: number): boolean {
  return width >= 900 || (width >= 700 && height >= 700)
}

export function isSlim(width: number, height: number): boolean {
  return isDesk(width, height) && width <= SLIM_MAX
}

// State of the agent list on a computer layout.
// docked: full sidebar; rail: narrow column; drawer: full list over the agent.
export type ListMode = 'phone' | 'docked' | 'rail' | 'drawer'
export function listMode(o: { desk: boolean, slim: boolean, collapsed: boolean, drawerOpen: boolean }): ListMode {
  if (!o.desk) return 'phone'
  if (o.slim) return o.drawerOpen ? 'drawer' : 'rail'
  return o.collapsed ? 'rail' : 'docked'
}

// Enter in the message field: sends on a computer. On an iPhone or iPad
// with the on-screen keyboard, Enter adds a line (the button sends). An iPad
// with a hardware keyboard shows no on-screen keyboard: Enter sends there too.
export function enterSends(o: { desk: boolean, touch: boolean, softKeyboard: boolean }): boolean {
  if (!o.desk) return false
  if (!o.touch) return true
  return !o.softKeyboard
}
