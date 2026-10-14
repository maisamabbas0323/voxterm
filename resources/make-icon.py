"""Rasterize the VoxTerm "V" monogram to a PNG app icon.

Drawn procedurally (numpy + PIL) so it needs no SVG rasterizer. Geometry
mirrors resources/icon.svg but is supersampled 8x before downscaling.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = "resources/icon.png"
FINAL = 512
SS = 8  # supersample factor
S = FINAL * SS


def P(v: float) -> float:
    """Map a 64-unit design coordinate to supersampled pixels."""
    return v / 64.0 * S


def vgrad(stops):
    ts = np.array([s[0] for s in stops], dtype=np.float64)
    t = np.linspace(0, 1, S)
    chans = [np.interp(t, ts, np.array([s[1][c] for s in stops], dtype=np.float64)) for c in range(3)]
    col = np.stack(chans, axis=-1)  # (S,3)
    return np.repeat(col[:, None, :], S, axis=1).astype(np.float32)  # (S,S,3)


def diag_grad(stops):
    ts = np.array([s[0] for s in stops], dtype=np.float64)
    lin = np.linspace(0, 1, S)
    t = (np.add.outer(lin, lin)) / 2.0  # top-left -> bottom-right
    chans = [np.interp(t, ts, np.array([s[1][c] for s in stops], dtype=np.float64)) for c in range(3)]
    return np.stack(chans, axis=-1).astype(np.float32)


def over(base, color, alpha):
    color = np.asarray(color, dtype=np.float32) / 255.0
    a = np.clip(alpha, 0.0, 1.0)[..., None].astype(np.float32)
    ab = base[..., 3:4]
    out_a = a + ab * (1 - a)
    safe = np.where(out_a > 1e-6, out_a, 1.0)
    base[..., :3] = (color * a + base[..., :3] * ab * (1 - a)) / safe
    base[..., 3] = out_a[..., 0]
    return base


def new_mask():
    return Image.new("L", (S, S), 0)


def as_alpha(img):
    return (np.asarray(img, dtype=np.float32) / 255.0)


def rgb(c):
    return np.array(c, dtype=np.float32)


# ---- palette ----
PLATE = [(0.0, (24, 24, 36)), (0.52, (12, 12, 18)), (1.0, (5, 5, 6))]
V_LEFT = [(0.0, (169, 193, 255)), (0.5, (122, 162, 247)), (1.0, (95, 134, 230))]
V_RIGHT = [(0.0, (125, 207, 255)), (0.55, (122, 162, 247)), (1.0, (187, 154, 247))]
WAVE = [(0.0, (164, 225, 255)), (1.0, (122, 162, 247))]

base = np.zeros((S, S, 4), dtype=np.float32)

# ---- plate ----
plate_mask_img = new_mask()
ImageDraw.Draw(plate_mask_img).rounded_rectangle([0, 0, S - 1, S - 1], radius=P(16), fill=255)
plate_mask = as_alpha(plate_mask_img)
over(base, vgrad(PLATE), plate_mask)

# inner border ring
ring_img = new_mask()
ImageDraw.Draw(ring_img).rounded_rectangle(
    [P(0.5), P(0.5), S - 1 - P(0.5), S - 1 - P(0.5)], radius=P(15.5), outline=255, width=max(1, int(P(1)))
)
over(base, rgb((122, 162, 247)), as_alpha(ring_img) * 0.22 * plate_mask)

# radial glow from the top
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
cx, cy, rad = 0.5 * S, 0.40 * S, 0.62 * S
dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rad
glow_alpha = np.clip(1.0 - dist, 0.0, 1.0) * 0.28 * plate_mask
over(base, rgb((122, 162, 247)), glow_alpha)

# ---- soft under-glow of the V ----
glowv_img = new_mask()
gd = ImageDraw.Draw(glowv_img)
gd.line([(P(15), P(14.5)), (P(32), P(45.5)), (P(49), P(14.5))], fill=255, width=int(P(11)), joint="curve")
for (px, py) in [(15, 14.5), (49, 14.5), (32, 45.5)]:
    r = P(11) / 2
    gd.ellipse([P(px) - r, P(py) - r, P(px) + r, P(py) + r], fill=255)
glowv = np.asarray(glowv_img.filter(ImageFilter.GaussianBlur(P(2.6))), dtype=np.float32) / 255.0
over(base, diag_grad(V_RIGHT), glowv * 0.5 * plate_mask)

# ---- waveform resting in the mouth of the V ----
wave_grad = vgrad(WAVE)
for x, y0, y1 in [(26.2, 28.6, 33.4), (32.0, 25.6, 36.4), (37.8, 27.4, 34.6)]:
    m = new_mask()
    w = P(2.4)
    ImageDraw.Draw(m).rounded_rectangle(
        [P(x) - w / 2, P(y0), P(x) + w / 2, P(y1)], radius=w / 2, fill=255
    )
    over(base, wave_grad, as_alpha(m) * 0.92 * plate_mask)

# ---- the V, as two beveled arms ----
left_img = new_mask()
ld = ImageDraw.Draw(left_img)
ld.line([(P(15), P(14.5)), (P(32), P(45.5))], fill=255, width=int(P(8.4)))
for (px, py) in [(15, 14.5), (32, 45.5)]:
    r = P(8.4) / 2
    ld.ellipse([P(px) - r, P(py) - r, P(px) + r, P(py) + r], fill=255)
over(base, diag_grad(V_LEFT), as_alpha(left_img) * plate_mask)

right_img = new_mask()
rd = ImageDraw.Draw(right_img)
rd.line([(P(32), P(45.5)), (P(49), P(14.5))], fill=255, width=int(P(8.4)))
for (px, py) in [(32, 45.5), (49, 14.5)]:
    r = P(8.4) / 2
    rd.ellipse([P(px) - r, P(py) - r, P(px) + r, P(py) + r], fill=255)
over(base, diag_grad(V_RIGHT), as_alpha(right_img) * plate_mask)

# ---- top-edge highlights ----
for (a, b, width, alpha) in [
    ((14.1, 13.6), (31.1, 44.6), 2.6, 0.40),
    ((31.1, 44.6), (48.1, 13.6), 2.4, 0.30),
]:
    m = new_mask()
    d = ImageDraw.Draw(m)
    d.line([(P(a[0]), P(a[1])), (P(b[0]), P(b[1]))], fill=255, width=int(P(width)))
    for (px, py) in [a, b]:
        r = P(width) / 2
        d.ellipse([P(px) - r, P(py) - r, P(px) + r, P(py) + r], fill=255)
    over(base, rgb((255, 255, 255)), as_alpha(m) * alpha * plate_mask)

# ---- vertex node ----
node = new_mask()
r = P(3)
ImageDraw.Draw(node).ellipse([P(32) - r, P(45.5) - r, P(32) + r, P(45.5) + r], fill=255)
over(base, rgb((234, 242, 255)), as_alpha(node) * plate_mask)

ring = new_mask()
rr = P(5.4)
w = max(1, int(P(1.1)))
ImageDraw.Draw(ring).ellipse([P(32) - rr, P(45.5) - rr, P(32) + rr, P(45.5) + rr], outline=255, width=w)
over(base, rgb((125, 207, 255)), as_alpha(ring) * 0.55 * plate_mask)

# ---- finish ----
img = Image.fromarray((np.clip(base, 0, 1) * 255).round().astype(np.uint8), "RGBA")
img = img.resize((FINAL, FINAL), Image.LANCZOS)
img.save(OUT)
print("wrote", OUT, img.size)
