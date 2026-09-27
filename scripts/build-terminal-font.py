"""Build the tiny terminal glyph font from DejaVu Sans Mono.

Requires fonttools and brotli. Usage:
  python scripts/build-terminal-font.py DejaVuSansMono.ttf app/assets/fonts/wherdr-symbols.woff2 NotoSansSymbols-Regular.ttf NotoSansSymbols2-Regular.ttf

DejaVu's blocks extend beyond its nominal em yet leave gaps in xterm's 16 px
HTML rows at a 12 px font size. Extend their vertical outlines so adjacent
rows touch after xterm clips each row. Keep the original monospace advance.
"""

import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter
from fontTools.ttLib.tables.ttProgram import Program


source, destination, noto_source, noto2_source = sys.argv[1:5]
font = TTFont(source)
cmap = font.getBestCmap()
points = set(range(0x2500, 0x25A0)) | {0x203A, 0x25B6, 0x25B8, 0x25CF, 0x25C6, 0x2733, 0x273B, 0x276F}

for codepoint in points:
    name = cmap.get(codepoint)
    if not name:
        continue
    glyph = font['glyf'][name]
    if glyph.isComposite():
        coordinates, ends, flags = glyph.getCoordinates(font['glyf'])
        glyph.numberOfContours = len(ends)
        glyph.coordinates = coordinates
        glyph.endPtsOfContours = ends
        glyph.flags = flags
        glyph.program = Program()
        del glyph.components
    if glyph.numberOfContours <= 0:
        continue
    coordinates = glyph.coordinates
    for i, (x, y) in enumerate(coordinates):
        coordinates[i] = (x, round(y * 1.25))
    glyph.recalcBounds(font['glyf'])

options = Options()
options.flavor = 'woff2'
options.layout_features = []
subsetter = Subsetter(options=options)
subsetter.populate(unicodes=points)
subsetter.subset(font)
font.flavor = 'woff2'
font.save(destination)


def build_noto_subset(source_path, codes, output_path):
    """Keep only requested glyphs and match JetBrains Mono's 0.6 em advance."""
    face = TTFont(source_path)
    cmap = face.getBestCmap()
    missing = codes - cmap.keys()
    if missing:
        raise ValueError(f'missing Noto glyphs: {sorted(hex(c) for c in missing)}')
    target_advance = round(face['head'].unitsPerEm * 0.6)
    for codepoint in codes:
        name = cmap[codepoint]
        glyph = face['glyf'][name]
        if glyph.isComposite():
            coordinates, ends, flags = glyph.getCoordinates(face['glyf'])
            glyph.numberOfContours = len(ends)
            glyph.coordinates = coordinates
            glyph.endPtsOfContours = ends
            glyph.flags = flags
            glyph.program = Program()
            del glyph.components
        advance, bearing = face['hmtx'][name]
        scale = target_advance / advance
        if glyph.numberOfContours > 0:
            for i, (x, y) in enumerate(glyph.coordinates):
                glyph.coordinates[i] = (round(x * scale), y)
            glyph.recalcBounds(face['glyf'])
        face['hmtx'][name] = (target_advance, round(bearing * scale))
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(face)
    face.flavor = 'woff2'
    face.save(output_path)


output_dir = Path(destination).parent
build_noto_subset(noto_source, {0x23BF}, output_dir / 'wherdr-symbols-technical.woff2')
build_noto_subset(noto2_source, {0x23F5, 0x23FA}, output_dir / 'wherdr-symbols-controls.woff2')
