// Une préférence absente suit le nouveau défaut ; les choix déjà enregistrés restent prioritaires.
export function readShowShells(stored: string | null): boolean {
  return stored !== '0'
}

// En-tête « Dépôt » : le clic replie ; le terminal racine passe par le menu
// (clic droit, appui long), absent quand les terminaux sont masqués.
export function repoHeaderState(showShells: boolean, open: boolean, hasRoot = true) {
  return { menu: showShells && hasRoot, selected: showShells && hasRoot && open }
}

// « 1 thread » / « 2 threads » (même mot en français et en anglais).
export function threadCountLabel(n: number) {
  return n === 1 ? '1 thread' : `${n} threads`
}
