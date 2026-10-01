// "Project" panel: when to read the project state (pure function, tested in
// tests/projectRefresh.test.ts).
//  - `poll`: panel visible, we read right away then poll;
//  - `probe`: panel hidden, we read once to know whether to show
//    the tab / button (availability still unknown);
//  - `none`: nothing (not a coordinator, herdr-projects missing, page hidden,
//    or offline state: on reload, the app first shows the last kept
//    state; the read starts as soon as the live state arrives).
export interface RefreshInput {
  coordinator: boolean
  offline: boolean
  visible: boolean
  pageVisible: boolean
  available: boolean | null
}
export type RefreshMode = 'poll' | 'probe' | 'none'

export function refreshMode(s: RefreshInput): RefreshMode {
  if (!s.coordinator || s.offline || s.available === false || !s.pageVisible) return 'none'
  if (s.visible) return 'poll'
  return s.available === null ? 'probe' : 'none'
}
