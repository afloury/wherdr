// Border of the message field when it has the focus (Settings › Appearance), kept on the
// device and applied as `data-focus-border` on <html> (styles in main.css):
// - border: the 1 px border takes the agent's color, a second color glides around it;
// - halo: the same, with a faint glow around the field;
// - off: plain 1 px accent border, no animation.
export const FOCUS_BORDERS = ['border', 'halo', 'off'] as const
export type FocusBorder = typeof FOCUS_BORDERS[number]
export const DEFAULT_FOCUS_BORDER: FocusBorder = 'border'

export function parseFocusBorder(v: unknown): FocusBorder {
  return FOCUS_BORDERS.includes(v as FocusBorder) ? v as FocusBorder : DEFAULT_FOCUS_BORDER
}
