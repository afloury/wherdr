// Context menus (right click, long press, "…" buttons): where they open.
// A floating menu at the pointer only on a computer layout driven by a fine
// pointer (mouse, trackpad). Narrow screens (< 900 px) and touch screens
// (`pointer: coarse`: phones, tablets) get the app's bottom sheet, with the
// same items. Pure (tested).
export function menuAsSheet(o: { desk: boolean, coarse: boolean }): boolean {
  return !o.desk || o.coarse
}
