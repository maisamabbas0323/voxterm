"""Rasterise the VoxTerm brand assets to PNG, with no SVG rasteriser needed.

The mark is pure stroke geometry (round caps), which PIL renders exactly, so
this script mirrors assets/brand/*.svg coordinates at 8x supersampling and
produces:

  assets/brand/favicon-16.png, -32.png, -48.png, -256.png   (mark only)
  resources/icon.png                                        (512 app icon)

Run from the repository root:  python3 scripts/make-favicons.py
"""
from math import hypot
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"

SS = 8  # supersample factor
ACCENT = (108, 140, 255)   # 6C8CFF
LIGHT = (242, 244, 248)    # F2F4F8
BLACK = (0, 0, 0)

# --- mark geometry (64-unit design box) -------------------------------------
CHEVRON = [(12.5, 19.5), (25.0, 32.0), (12.5, 44.5)]
BARS = [
    # x, y_top, y_bottom, colour-role
    (35.5, 26.5, 38.5, "plain"),
    (45.0, 18.0, 46.5, "accent"),
    (54.5, 23.0, 42.0, "plain"),
]
CHEVRON_W = 6.5
BAR_W = 6.0


def render_mark(size: int, plain_color, accent_color, background=None,
                radius: int | None = None) -> Image.Image:
    """Draw the mark into a size x size RGBA image.

    background: optional fill colour painted first (rounded when radius given).
    """
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if background is not None:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius or 0, fill=background)

    def P(v: float) -> float:
        return v / 64.0 * big

    def thick_line(p1, p2, width, colour):
        """Line with round caps, drawn as a stroked capsule."""
        (x1, y1), (x2, y2) = p1, p2
        w = width / 64.0 * big
        draw.line([x1, y1, x2, y2], fill=colour, width=int(round(w)))
        r = w / 2.0
        for (cx, cy) in ((x1, y1), (x2, y2)):
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)

    def thick_polyline(points, width, colour):
        for a, b in zip(points, points[1:]):
            thick_line(a, b, width, colour)

    thick_polyline([(P(x), P(y)) for x, y in CHEVRON], CHEVRON_W, plain_color)
    for (x, y_top, y_bot, role) in BARS:
        colour = accent_color if role == "accent" else plain_color
        thick_line((P(x), P(y_top)), (P(x), P(y_bot)), BAR_W, colour)

    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({img.width}x{img.height})")


# Favicons: the mark on its black rounded plate — near-white strokes stay
# readable on both light and dark surfaces (a bare light mark would vanish on
# white browser tabs). Radius mirrors the 512 icon (112/512).
for size in (16, 32, 48, 256):
    radius = int(round(size * 112 / 512))
    save(render_mark(size, LIGHT, ACCENT, background=BLACK, radius=radius), BRAND / f"favicon-{size}.png")

# Linux/Electron app icon: mark centred at ~55% width on a black rounded
# square. The mark box is 64 wide; 55% of the canvas is the box width, so we
# paste the rendered mark (already rounded-cap-correct) onto the plate.
ICON = 512
plate = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
pdraw = ImageDraw.Draw(plate)
pdraw.rounded_rectangle([0, 0, ICON - 1, ICON - 1], radius=112, fill=BLACK + (255,))

mark_box = int(ICON * 0.55/ (54.5 + 3.0) * 64) + 0  # mark content spans ~57.5 units
# Simpler: render the full 64-unit box at 55% of the icon width, then centre it.
box = int(round(ICON * 0.55))
mark = render_mark(box, LIGHT, ACCENT)
plate.paste(mark, ((ICON - box) // 2, (ICON - box) // 2), mark)
save(plate, ROOT / "resources" / "icon.png")
