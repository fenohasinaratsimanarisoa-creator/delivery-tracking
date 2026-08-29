#!/usr/bin/env python3
import struct, zlib, math, os

C_AMBER = (242, 169, 60)
C_ORANGE = (232, 117, 60)
C_TEAL = (20, 184, 166)
DARK = (20, 31, 55)
WHITE = (255, 255, 255)


def chunk(t: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)


def png_bytes(size: int, px: list) -> bytes:
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(row) for row in px)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def grad(t: float):
    if t <= 0.55:
        k = max(0.0, min(1.0, t / 0.55)); a, b = C_AMBER, C_ORANGE
    else:
        k = max(0.0, min(1.0, (t - 0.55) / 0.45)); a, b = C_ORANGE, C_TEAL
    return tuple(o + (p - o) * k for o, p in zip(a, b))


def sd(px, py, cx, cy, r):
    return math_hypot(px - cx, py - cy) - r


def blend(c, d, a):
    return tuple(o + (p - o) * max(0.0, min(1.0, a)) for o, p in zip(c, d))


def render(size: int, mask: bool) -> bytes:
    s2 = size / 2.0
    head = (s2, size * (0.40 if mask else 0.38), size * 0.17)
    tail = (s2, size * (0.66 if mask else 0.64), size * 0.21)
    inner = (head[0], head[1] - size * 0.075, head[2] * 0.42)
    dot = (inner[0], inner[1], inner[2] * 0.34)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            u, v = (x + 0.5) / size, (y + 0.5) / size
            col = grad(u * 0.45 + v * 0.55)
            d = min(sd(x, y, *head), sd(x, y, tail[0], tail[1] + size * 0.06, tail[2]))
            if d < 0:
                col = blend(col, WHITE, -d * 2)
            d = sd(x, y, *inner)
            if d < 0:
                col = blend(col, DARK, -d * 2)
            d = sd(x, y, *dot)
            if d < 0:
                col = blend(col, C_AMBER, -d * 2)
            row.extend(int(c) & 255 for c in col)
        rows.append(row)
    return png_bytes(size, rows)


def math_hypot(a, b):
    return (a * a + b * b) ** 0.5


if __name__ == "__main__":
    os.makedirs("public/icons", exist_ok=True)
    for size, mask, name in [
        (192, False, "icon-192.png"),
        (192, True, "icon-192-maskable.png"),
        (512, True, "icon-512-maskable.png"),
    ]:
        data = render(size, mask)
        with open("public/icons/" + name, "wb") as f:
            f.write(data)
        print(name, len(data))