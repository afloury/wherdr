// Hash routing keeps installed PWA and notification URLs stable. Convert a
// pathname deep link to the same canonical URL before the app renders.
export function directRoute(pathname: string, search: string, hash: string): string | null {
  if (!/^\/(?:t|a)\/[^/]+\/?$/.test(pathname)) return null
  // A hash route already there wins; the deep-link path left in front of it
  // (a link reopened after navigating) is dropped so the address shows one view.
  if (hash && hash !== '#/' && hash !== '#') return `/${hash}`
  // Vue Router inserts an empty #/ before client plugins run on a cold load.
  return `/#${pathname}${search}`
}
