// Une préférence absente suit le nouveau défaut ; les choix déjà enregistrés restent prioritaires.
export function readShowShells(stored: string | null): boolean {
  return stored !== '0'
}

export function repoHeaderState(showShells: boolean, open: boolean) {
  return { tag: showShells ? 'button' : 'div', selected: showShells && open }
}
