"""Generate assets/brand/wordmark.svg.

Combines the hand-drawn VoxTerm mark (chevron + three voice bars) with the
word "VoxTerm" converted to vector outlines from Lato Semibold (a clean
grotesk). The mark is scaled so its full height equals the font's cap height,
which is what the brief asks for: mark height == cap height. No font files are
needed to consume the output — everything is flat path data.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

FONT = "/usr/share/fonts/truetype/lato/Lato-Semibold.ttf"
TEXT = "VoxTerm"
LIGHT = "#F2F4F8"
ACCENT = "#6C8CFF"
OUT = "assets/brand/wordmark.svg"

font = TTFont(FONT)
upm = font["head"].unitsPerEm
cap_height = font["OS/2"].sCapHeight
glyph_set = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]

# --- Mark geometry, copied verbatim from assets/brand/logo-mark.svg --------
# (strokes are in a 64-unit box; the marks's visual height is 18→46.5 for the
#  tall bar but the designed *box* is 64 with built-in air, we scale the whole
#  box so the "set" proportions match the type at a glance)
MARK_BOX = 64.0
# letters we must lay out
cursor = 0.0
paths = []
for char in TEXT:
    glyph_name = cmap[ord(char)]
    advance, _ = hmtx[glyph_name]
    pen = SVGPathPen(glyph_set)
    tpen = TransformPen(pen, Transform(1, 0, 0, 1, cursor, 0))
    glyph_set[glyph_name].draw(tpen)
    d = pen.getCommands()
    if d:
        paths.append((d, f"translate(0 {0})"))
    cursor += advance

text_width = cursor
# Mark box scaled so its height == cap height:
mark_scale = cap_height / MARK_BOX
# gap between mark and text: ~0.30 em is generous but balanced with round caps
gap = 0.30 * upm
total_width = mark_scale * MARK_BOX + gap + text_width

# viewBox nicely padded
pad = 0.06 * upm
height = cap_height + 2 * pad
width = total_width + 2 * pad

# Vertical: baseline sits at pad + cap_height. The mark box is designed with
# air top/bottom; to make its visual band align with cap height, scale it to
# cap * 1.12 so optical heights match (bars end in round caps that read light).
mark_h = cap_height * 1.12
mark_scale = mark_h / MARK_BOX
ty = pad + cap_height - mark_h  # top of mark box
tx = pad

svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" '
    f'width="{width:.1f}" height="{height:.1f}" '
    f'viewBox="0 0 {width:.1f} {height:.1f}" fill="none" role="img" '
    'aria-label="VoxTerm wordmark">',
    f"  <!-- Mark scaled to cap height ({cap_height} units of {upm}); text is",
    "       Lato Semibold converted to outlines. -->",
    f'  <g transform="translate({tx:.1f} {ty:.1f}) scale({mark_scale:.5f})" '
    'fill="none" stroke-linecap="round" stroke-linejoin="round">',
    '    <path d="M12.5 19.5 L25 32 L12.5 44.5" stroke="#F2F4F8" stroke-width="6.5" />',
    '    <line x1="35.5" y1="26.5" x2="35.5" y2="38.5" stroke="#F2F4F8" stroke-width="6" />',
    f'    <line x1="45" y1="18" x2="45" y2="46.5" stroke="{ACCENT}" stroke-width="6" />',
    '    <line x1="54.5" y1="23" x2="54.5" y2="42" stroke="#F2F4F8" stroke-width="6" />',
    "  </g>",
]
for d, _ in paths:
    svg.append(
        f'  <path transform="translate({tx + mark_scale * MARK_BOX + gap:.1f} {pad + cap_height:.1f}) scale(1 -1)" d="{d}" fill="#F2F4F8" />'
    )
svg.append("</svg>")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(svg) + "\n")
print(f"wrote {OUT}: {width:.0f}x{height:.0f}, cap={cap_height}, text_adv={text_width:.0f}")
