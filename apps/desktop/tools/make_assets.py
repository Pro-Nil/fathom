"""Generate the desktop app's icon (app.ico) and notification chime (notify.wav).

Run: python apps/desktop/tools/make_assets.py
The icon redraws the harness mark (shield + reticle, 24-unit grid) on a dark
carbon tile; the chime is a short two-note "sonar ping" unique to this app.
"""
import math, struct, wave, pathlib
import numpy as np
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)

def shield_points(s, ox, oy):
    # M12 2.5 19 5v6c0 4.9-2.8 8.6-7 10.5C7.8 19.6 5 15.9 5 11V5l7-2.5Z
    def cubic(p0, p1, p2, p3, n=24):
        return [tuple((1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t**2*c + t**3*d for a, b, c, d in zip(p0, p1, p2, p3))
                for t in (i / n for i in range(1, n + 1))]
    pts = [(12, 2.5), (19, 5), (19, 11)]
    pts += cubic((19, 11), (19, 15.9), (16.2, 19.6), (12, 21.5))
    pts += cubic((12, 21.5), (7.8, 19.6), (5, 15.9), (5, 11))
    pts += [(5, 5), (12, 2.5)]
    return [(ox + x * s, oy + y * s) for x, y in pts]

def tile(size):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22)
    d.rounded_rectangle((0, 0, S - 1, S - 1), r, fill=(17, 17, 20, 255))
    # carbon twill on the tile
    cell = max(4, S // 16)
    weave = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    wd = ImageDraw.Draw(weave)
    for y in range(0, S, cell):
        for x in range(0, S, cell):
            lit = ((x // cell) + (y // cell)) % 2 == 0
            shade = (25, 25, 29, 255) if lit else (20, 20, 24, 255)
            wd.rectangle((x, y, x + cell - 1, y + cell // 2 - 1), fill=shade)
            wd.rectangle((x, y + cell // 2, x + cell - 1, y + cell - 1), fill=(20, 20, 24, 255) if lit else (25, 25, 29, 255))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), r, fill=255)
    img.paste(weave, (0, 0), mask)
    # mark
    s = S / 24 * 0.82
    ox = oy = (S - 24 * s) / 2
    w = max(2, int(s * (2.0 if size <= 32 else 1.3)))
    ink = (236, 236, 240, 255)
    d.line(shield_points(s, ox, oy), fill=ink, width=w, joint="curve")
    cx, cy = ox + 12 * s, oy + 11 * s
    rr = 3.4 * s
    if size > 20:
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=ink, width=w)
        for (x1, y1, x2, y2) in [(12, 5.6, 12, 7.6), (12, 14.4, 12, 16.4), (5.6, 11, 7.6, 11), (14.4, 11, 16.4, 11)]:
            d.line((ox + x1 * s, oy + y1 * s, ox + x2 * s, oy + y2 * s), fill=ink, width=w)
    dot = (1.25 if size > 20 else 2.2) * s
    d.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=(59, 130, 246, 255))
    return img.resize((size, size), Image.LANCZOS)

sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
imgs = [tile(n) for n in sizes]
imgs[-1].save(OUT / "app.ico", sizes=[(n, n) for n in sizes], append_images=imgs[:-1])
imgs[-1].save(OUT / "app.png")

# Notification chime: two bell-like partials, a quick upward step, then a soft sonar tail.
rate = 44100
t = np.arange(int(rate * 0.95)) / rate
def bell(f, start, dur, amp):
    out = np.zeros_like(t)
    m = (t >= start) & (t < start + dur)
    tt = t[m] - start
    env = np.minimum(1, tt / 0.004) * np.exp(-tt * 7.5)
    tone = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 14) + 0.18 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 22)
    out[m] = amp * env * tone
    return out
sig = bell(988.0, 0.0, 0.5, 0.55) + bell(1480.0, 0.11, 0.8, 0.6)
# sonar tail: faint gliding sine 1480 -> 1320 Hz with slow decay
tail_start = 0.11
m = t >= tail_start
tt = t[m] - tail_start
freq = 1480 - 160 * (1 - np.exp(-tt * 3))
phase = 2 * np.pi * np.cumsum(freq) / rate
sig[m] += 0.12 * np.sin(phase) * np.exp(-tt * 4.2) * np.minimum(1, tt / 0.05)
fade = np.minimum(1, (t[-1] - t) / 0.08)
sig *= fade
sig = sig / np.max(np.abs(sig)) * 0.70  # about -3 dBFS
pcm = (sig * 32767).astype("<i2")
with wave.open(str(OUT / "notify.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
print("wrote", sorted(p.name for p in OUT.iterdir()))
