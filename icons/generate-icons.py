#!/usr/bin/env python3
"""Generate Tabstaq's extension icons (16/48/128 px) as transparent PNGs.

The mark is three amber "cards" stacked diagonally with a small browser-tab
notch on the front card — i.e. a stack of tabs. Pure stdlib (struct + zlib), so
it runs anywhere with Python 3 and needs no Pillow/ImageMagick.

Usage:
    python3 generate-icons.py
"""

import struct
import zlib

# Amber palette, light -> dark, matching the in-app accent (#e8821e).
BACK = (250, 224, 170)
MID = (245, 185, 90)
FRONT = (232, 130, 30)


def _in_rounded_rect(x, y, x0, y0, x1, y1, r):
    """True if point (x, y) is inside the rounded rectangle [x0,y0,x1,y1]."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _render(size, supersample=4):
    """Render the mark at `size`px, antialiased via supersampling."""
    s = size * supersample
    card_w, card_h, radius = s * 0.52, s * 0.46, s * 0.10
    offset, top = s * 0.14, s * 0.20
    cards = [
        (BACK, s * 0.12, top + 2 * offset),
        (MID, s * 0.12 + offset, top + offset),
        (FRONT, s * 0.12 + 2 * offset, top),
    ]
    # Tab notch centered on the top edge of the front card.
    front_x = s * 0.12 + 2 * offset
    lobe_w = card_w * 0.46
    tab_x0 = front_x + (card_w - lobe_w) / 2
    tab_x1 = tab_x0 + lobe_w
    tab_y0, tab_y1, tab_r = top - card_h * 0.26, top + radius, card_h * 0.10

    pixels = [[(0, 0, 0, 0)] * s for _ in range(s)]
    for py in range(s):
        for px in range(s):
            x, y = px + 0.5, py + 0.5
            for color, cx, cy in cards:
                if _in_rounded_rect(x, y, cx, cy, cx + card_w, cy + card_h, radius):
                    pixels[py][px] = (*color, 255)
            if _in_rounded_rect(x, y, tab_x0, tab_y0, tab_x1, tab_y1, tab_r):
                pixels[py][px] = (*FRONT, 255)

    # Downsample (box filter) to the final size, premultiplying by alpha.
    out = bytearray()
    for oy in range(size):
        out.append(0)  # PNG per-row filter byte
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(supersample):
                for dx in range(supersample):
                    pr, pg, pb, pa = pixels[oy * supersample + dy][ox * supersample + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a:
                out += bytes((r // a, g // a, b // a, a // (supersample * supersample)))
            else:
                out += bytes((0, 0, 0, 0))
    return bytes(out)


def _write_png(size, path):
    raw = _render(size)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path}")


if __name__ == "__main__":
    for px in (16, 48, 128):
        _write_png(px, f"icon{px}.png")
