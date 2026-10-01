// A missing preference follows the new default; choices already saved take priority.
export function readShowShells(stored: string | null): boolean {
  return stored !== '0'
}

// "Repository" header: a click collapses; the root terminal goes through the menu
// (right click, long press), absent when terminals are hidden.
export function repoHeaderState(showShells: boolean, open: boolean, hasRoot = true) {
  return { menu: showShells && hasRoot, selected: showShells && hasRoot && open }
}

// "1 thread" / "2 threads" (same word in French and English).
export function threadCountLabel(n: number) {
  return n === 1 ? '1 thread' : `${n} threads`
}
