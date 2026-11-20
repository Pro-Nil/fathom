"""Generate every Fathom brand asset from one mark geometry.

Run from the repository root:  python scripts/make-brand-assets.py

The mark is a sounding: a source point with three wavefronts reaching down,
each one narrower than the last, like a sonar beam taking the depth. It is
drawn on a 24-unit grid (the UI icon grid) and written as:

- apps/web/public/brand/fathom-mark.svg   teal mark, transparent background
- apps/web/public/favicon.svg             mono mark: black, white under a dark scheme
- apps/web/public/favicon.png             256 px app tile
- apps/desktop/assets/app.png, app.ico    desktop app tile (the chime stays in make_assets.py)
- docs/images/fathom-banner.png           README banner
- packages/skill/skill-badge/assets/fathom-badge.png   "powered by fathom" badge (726x120)

The UI component (packages/client/ui-primitives/src/FathomLogo.tsx) inlines
the same path data; `python scripts/make-brand-assets.py --paths` prints it.
"""
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent

INK = (10, 14, 20)          # #0A0E14 deep water
TEAL = (45, 212, 191)       # #2DD4BF
TEAL_DEEP = (15, 118, 110)  # #0F766E
MIST = (148, 163, 184)      # #94A3B8

# Source point and wavefronts on the 24-unit grid: (radius, half-span in degrees, opacity).
SOURCE = (12.0, 3.4)
DOT_R = 2.1
STROKE = 2.2
# Each wavefront narrower than the one above: the beam closes in as it goes deep.
WAVES = [(6.0, 62, 1.0), (10.6, 27, 0.72), (15.2, 12.5, 0.45)]


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def wave_path(r, half_span, ox=0.0, oy=0.0, s=1.0):
    """A round-capped arc of radius r centred straight down, as a filled SVG path."""
    cx, cy = SOURCE
    a0, a1 = 90 - half_span, 90 + half_span
    R, ri, cap = r + STROKE / 2, r - STROKE / 2, STROKE / 2

    def pt(rad, deg):
        x, y = polar(cx, cy, rad, deg)
        return f'{ox + x * s:.3f} {oy + y * s:.3f}'
    k = lambda v: f'{v * s:.3f}'
    return (f'M{pt(R, a0)}A{k(R)} {k(R)} 0 0 1 {pt(R, a1)}'
            f'A{k(cap)} {k(cap)} 0 0 1 {pt(ri, a1)}'
            f'A{k(ri)} {k(ri)} 0 0 0 {pt(ri, a0)}'
            f'A{k(cap)} {k(cap)} 0 0 1 {pt(R, a0)}Z')


def dot_path():
    cx, cy = SOURCE
    return f'M{cx - DOT_R} {cy}a{DOT_R} {DOT_R} 0 1 0 {2 * DOT_R} 0a{DOT_R} {DOT_R} 0 1 0 {-2 * DOT_R} 0Z'


def mark_svg_body(color, fade=True):
    hexc = '#%02X%02X%02X' % color
    parts = [f'<path d="{dot_path()}" fill="{hexc}"/>']
    for r, half, alpha in WAVES:
        op = f' fill-opacity="{alpha}"' if fade and alpha < 1 else ''
        parts.append(f'<path d="{wave_path(r, half)}" fill="{hexc}"{op}/>')
    return '\n  '.join(parts)


def write_svgs():
    brand = ROOT / 'apps/web/public/brand'
    brand.mkdir(parents=True, exist_ok=True)
    (brand / 'fathom-mark.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">\n'
        f'  <title>Fathom</title>\n  {mark_svg_body(TEAL)}\n</svg>\n', encoding='utf-8', newline='\n')
    # The favicon follows the browser chrome: black on light, white on dark.
    body = mark_svg_body((0, 0, 0), fade=False).replace('fill="#000000"', 'fill="#000"')
    (ROOT / 'apps/web/public/favicon.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">\n'
        '  <style>@media (prefers-color-scheme: dark) { path { fill: #fff; } }</style>\n'
        f'  {body}\n</svg>\n', encoding='utf-8', newline='\n')


def draw_mark(img, box, color, fade=True):
    """Draw the mark into box=(x, y, size) on an RGBA image (already supersampled)."""
    x0, y0, size = box
    s = size / 24
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = SOURCE
    for r, half, alpha in WAVES:
        a = int(255 * (alpha if fade else 1))
        pts = []
        steps = 96
        a0, a1 = 90 - half, 90 + half
        outer = [polar(cx, cy, r + STROKE / 2, a0 + (a1 - a0) * i / steps) for i in range(steps + 1)]
        inner = [polar(cx, cy, r - STROKE / 2, a1 - (a1 - a0) * i / steps) for i in range(steps + 1)]
        pts = [(x0 + px * s, y0 + py * s) for px, py in outer + inner]
        wl = Image.new('RGBA', img.size, (0, 0, 0, 0))
        wd = ImageDraw.Draw(wl)
        wd.polygon(pts, fill=color + (255,))
        for deg in (a0, a1):
            ex, ey = polar(cx, cy, r, deg)
            rr = STROKE / 2 * s
            wd.ellipse((x0 + ex * s - rr, y0 + ey * s - rr, x0 + ex * s + rr, y0 + ey * s + rr), fill=color + (255,))
        if a < 255:
            alpha_ch = wl.getchannel('A').point(lambda v: v * a // 255)
            wl.putalpha(alpha_ch)
        layer = Image.alpha_composite(layer, wl)
    d = ImageDraw.Draw(layer)
    rr = DOT_R * s
    d.ellipse((x0 + cx * s - rr, y0 + cy * s - rr, x0 + cx * s + rr, y0 + cy * s + rr), fill=color + (255,))
    img.alpha_composite(layer)


def tile(size):
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, S - 1, S - 1), int(S * 0.22), fill=INK + (255,))
    inner = S * 0.74
    # The mark's ink sits a little above the grid centre; nudge it to the optical centre.
    draw_mark(img, ((S - inner) / 2, (S - inner) / 2 + S * 0.035, inner), TEAL, fade=size > 24)
    return img.resize((size, size), Image.LANCZOS)


def write_tiles():
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    imgs = [tile(n) for n in sizes]
    assets = ROOT / 'apps/desktop/assets'
    imgs[-1].save(assets / 'app.ico', sizes=[(n, n) for n in sizes], append_images=imgs[:-1])
    imgs[-1].save(assets / 'app.png')
    imgs[-1].save(ROOT / 'apps/web/public/favicon.png')


def font(name, px):
    for path in (f'C:/Windows/Fonts/{name}', f'/usr/share/fonts/truetype/msttcorefonts/{name}'):
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, px)
    raise SystemExit(f'font {name} not found; run this on Windows or install it')


def write_banner():
    W, H, k = 1280, 320, 2
    img = Image.new('RGBA', (W * k, H * k), INK + (255,))
    mark = 190 * k
    draw_mark(img, (96 * k, (H * k - mark) // 2 + 10 * k, mark), TEAL)
    d = ImageDraw.Draw(img)
    word = font('seguisb.ttf', 112 * k)
    tag = font('segoeui.ttf', 28 * k)
    tagline = 'An AI agent workspace for authorized security testing'
    # Stack wordmark and tagline as one block, centred on the banner height.
    wb, tb, gap = d.textbbox((0, 0), 'Fathom', font=word), d.textbbox((0, 0), tagline, font=tag), 22 * k
    block = (wb[3] - wb[1]) + gap + (tb[3] - tb[1])
    top = (H * k - block) // 2
    x = 312 * k
    d.text((x - wb[0], top - wb[1]), 'Fathom', font=word, fill=(241, 245, 249, 255))
    d.text((x + 4 * k - tb[0], top + (wb[3] - wb[1]) + gap - tb[1]), tagline, font=tag, fill=MIST + (255,))
    img.resize((W, H), Image.LANCZOS).convert('RGB').save(ROOT / 'docs/images/fathom-banner.png', optimize=True)


def write_badge():
    # 121x20 Shields-style flat-square badge, drawn at 6x (726x120).
    k, H = 6, 20
    f = font('verdana.ttf', 11 * k)
    left, right = 'powered by', 'fathom'
    lw = int(f.getlength(left)) // k + 10
    rw = 121 - lw
    img = Image.new('RGB', (121 * k, H * k), (85, 85, 85))
    d = ImageDraw.Draw(img)
    d.rectangle((lw * k, 0, 121 * k, H * k), fill=TEAL_DEEP)
    for text, x0, w in ((left, 0, lw), (right, lw, rw)):
        tw = f.getlength(text)
        x = x0 * k + (w * k - tw) / 2
        d.text((x, 14.5 * k), text, font=f, fill=(1, 1, 1), anchor='ls')     # shadow
        d.text((x, 13.5 * k), text, font=f, fill=(255, 255, 255), anchor='ls')
    img.save(ROOT / 'packages/skill/skill-badge/assets/fathom-badge.png', optimize=True)


if __name__ == '__main__':
    if '--paths' in sys.argv:
        print('dot', dot_path())
        for r, half, alpha in WAVES:
            print(alpha, wave_path(r, half))
        raise SystemExit
    write_svgs()
    write_tiles()
    write_banner()
    write_badge()
    print('brand assets written')
