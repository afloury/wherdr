// Hash routing keeps installed PWA and notification URLs stable. Convert a
// pathname deep link to the same canonical URL before the app renders.
export function directRoute(pathname: string, search: string, hash: string): string | null {
  // Vue Router inserts an empty #/ before client plugins run on a cold load.
  if ((hash && hash !== '#/' && hash !== '#') || !/^\/(?:t|a)\/[^/]+\/?$/.test(pathname)) return null
  return `/#${pathname}${search}`
}
