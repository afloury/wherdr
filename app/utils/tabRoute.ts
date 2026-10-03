// A deep-linked tab can be absent while the first server snapshot is loading.
export function tabRouteStatus(found: boolean, stateOk: boolean, stateReady: boolean, graceOver: boolean, seen: boolean): 'open' | 'loading' | 'unavailable' {
  if (found) return 'open'
  return stateOk && stateReady && (seen || graceOver) ? 'unavailable' : 'loading'
}
