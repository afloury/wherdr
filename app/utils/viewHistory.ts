// Detail routes share the same policy for header back and native browser back.
export function isDetailRoute(path: string): boolean {
  return path.startsWith('/a/') || path.startsWith('/t/')
}

export function internalBack(back: unknown): back is string {
  return typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')
}
