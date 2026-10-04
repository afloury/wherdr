"""Build the terminal's Nerd Font fallback from Symbols Nerd Font Mono.

Requires fonttools and brotli. Usage:
  python scripts/build-nerd-font.py SymbolsNerdFontMono-Regular.ttf app/assets/fonts

Source: NerdFontsSymbolsOnly from https://github.com/ryanoasis/nerd-fonts
(release v3.5.1). Only the Private Use Area icons are kept; the few
non-PUA code points of the font (U+23FB, U+2665, U+276F, ...) stay with the
other faces.

Each output file holds one or two icon sets so that, through the CSS
`unicode-range`, the browser downloads only the sets of the glyphs on
screen (a Powerline status bar costs a few kilobytes, not the whole font).
xterm gives PUA characters a single cell, so every glyph is
narrowed to JetBrains Mono's 0.600 em advance:
- icons are scaled uniformly and centred in the cell, like the "Mono"
  variants of the patched fonts;
- Powerline separators (U+E0B0-U+E0D7) are scaled horizontally only and
  stretched to cover the whole row, so segments of a status bar touch.
"""

import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter
from fontTools.ttLib.tables.ttProgram import Program

ADVANCE = 0.6
# Vertical span of a terminal row with JetBrains Mono (ascent 1.020 em,
# descent 0.300 em), which xterm uses at line height 1.
ROW_TOP, ROW_BOTTOM = 1.02, -0.3

# Output file -> code point ranges (inclusive), mirrored by the @font-face
# rules of app/assets/css/main.css. Pomicons (U+E000-U+E00A) are left out:
# reserved font name and practically unused in terminals.
GROUPS = {
    'wherdr-nerd-powerline.woff2': [(0xE0A0, 0xE0D7)],  # Powerline + Powerline Extra
    'wherdr-nerd-extension.woff2': [(0xE200, 0xE3E3)],  # Font Awesome Extension + Weather
    'wherdr-nerd-devicons.woff2': [(0xE5FA, 0xE8EF)],  # Seti UI + Devicons
    'wherdr-nerd-codicons.woff2': [(0xEA60, 0xEC1E)],  # Codicons
    'wherdr-nerd-awesome.woff2': [(0xED00, 0xF2FF)],  # Font Awesome
    'wherdr-nerd-octicons.woff2': [(0xF300, 0xF381), (0xF400, 0xF533)],  # Font Logos + Octicons
    # Material Design Icons (supplementary PUA), in four slices.
    'wherdr-nerd-material-1.woff2': [(0xF0001, 0xF06FF)],
    'wherdr-nerd-material-2.woff2': [(0xF0700, 0xF0DFF)],
    'wherdr-nerd-material-3.woff2': [(0xF0E00, 0xF14FF)],
    'wherdr-nerd-material-4.woff2': [(0xF1500, 0xF1AF0)],
}
SEPARATORS = range(0xE0B0, 0xE0D8)


def flatten(glyph, glyf):
    if glyph.isComposite():
        coordinates, ends, flags = glyph.getCoordinates(glyf)
        glyph.numberOfContours = len(ends)
        glyph.coordinates = coordinates
        glyph.endPtsOfContours = ends
        glyph.flags = flags
        glyph.program = Program()
        del glyph.components


def build(source, ranges, output):
    face = TTFont(source)
    upm = face['head'].unitsPerEm
    cmap = face.getBestCmap()
    codes = {c for c in cmap if any(lo <= c <= hi for lo, hi in ranges)}
    target = round(upm * ADVANCE)
    top, bottom = ROW_TOP * upm, ROW_BOTTOM * upm
    middle = (top + bottom) / 2
    glyf = face['glyf']
    for name in {cmap[c] for c in codes}:
        flatten(glyf[name], glyf)
    done = set()
    for code in sorted(codes):
        name = cmap[code]
        if name in done:
            continue
        done.add(name)
        glyph = glyf[name]
        advance = face['hmtx'][name][0]
        if glyph.numberOfContours > 0:
            glyph.recalcBounds(glyf)
            if code in SEPARATORS:
                # Full row height, horizontal squeeze to the cell.
                sx = target / advance
                sy = (top - bottom) / max(glyph.yMax - glyph.yMin, 1)
                y0 = glyph.yMin
                points = [(x * sx, bottom + (y - y0) * sy) for x, y in glyph.coordinates]
            else:
                height = glyph.yMax - glyph.yMin
                scale = min(target / advance, (top - bottom) / max(height, 1))
                cx, cy = (glyph.xMin + glyph.xMax) / 2, (glyph.yMin + glyph.yMax) / 2
                # Keep the icon's horizontal position relative to its cell,
                # centre it vertically in the row.
                ox = target / 2 + (cx - advance / 2) * scale
                points = [(ox + (x - cx) * scale, middle + (y - cy) * scale) for x, y in glyph.coordinates]
            for i, (x, y) in enumerate(points):
                glyph.coordinates[i] = (round(x), round(y))
            glyph.recalcBounds(glyf)
            face['hmtx'][name] = (target, glyph.xMin)
        else:
            face['hmtx'][name] = (target, 0)
    options = Options()
    options.flavor = 'woff2'
    options.layout_features = []
    options.name_IDs = []
    options.hinting = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(face)
    face.flavor = 'woff2'
    face.save(output)
    print(f'{output}: {len(codes)} glyphs, {Path(output).stat().st_size} bytes')


source, out_dir = sys.argv[1:3]
for file, ranges in GROUPS.items():
    build(source, ranges, Path(out_dir) / file)
