#!/usr/bin/env python3
"""Build index-preview.png: a 2x2 montage of the four widget previews.

Each tile is center-cropped to the tile aspect, rounded, and floated on a
white ground with a soft drop shadow, in the style of the landing-page
previews on the sibling course sites. Run from the repository root:

    python3 make_index_preview.py

Regenerate whenever one of the four source previews changes, and keep the
og:image:width/height in index.html in step with W and H below. Tiles read
in index order, left to right and top to bottom.
"""

from PIL import Image, ImageDraw, ImageFilter

W, H = 2400, 1200          # canvas; keep the ratio near 2:1 for Twitter/X
MARGIN, GUTTER = 48, 48
RADIUS = 20                # tile corner radius
SHADOW_ALPHA = 60          # 0-255
SHADOW_BLUR = 16
SHADOW_OFFSET = (0, 10)
AA = 4                     # supersampling factor for smooth corners

SOURCES = [
    'monte_carlo/mc_explorer-preview.png',
    'prng/prng_explorer-preview.png',
    'input_modeling/input_analyzer-preview.png',
    'power_analysis/power_explorer-preview.png',
]

tile_w = (W - 2 * MARGIN - GUTTER) // 2
tile_h = (H - 2 * MARGIN - GUTTER) // 2


def center_crop_to(im, w, h):
    """Largest center crop of im with aspect w:h, resized to (w, h)."""
    sw, sh = im.size
    if sw * h > sh * w:                  # too wide: crop the sides
        cw = sh * w // h
        box = ((sw - cw) // 2, 0, (sw - cw) // 2 + cw, sh)
    else:                                # too tall: crop top and bottom
        ch = sw * h // w
        box = (0, (sh - ch) // 2, sw, (sh - ch) // 2 + ch)
    return im.crop(box).resize((w, h), Image.LANCZOS)


def rounded_mask(w, h, radius):
    """Antialiased rounded-rectangle mask, drawn at AA scale."""
    m = Image.new('L', (w * AA, h * AA), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, w * AA - 1, h * AA - 1), radius=radius * AA, fill=255)
    return m.resize((w, h), Image.LANCZOS)


canvas = Image.new('RGB', (W, H), '#ffffff')
mask = rounded_mask(tile_w, tile_h, RADIUS)

# One shared shadow stamp: the mask silhouette, blurred.
pad = SHADOW_BLUR * 3
shadow = Image.new('L', (tile_w + 2 * pad, tile_h + 2 * pad), 0)
shadow.paste(mask.point(lambda v: v * SHADOW_ALPHA // 255), (pad, pad))
shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))

for i, src in enumerate(SOURCES):
    x = MARGIN + (i % 2) * (tile_w + GUTTER)
    y = MARGIN + (i // 2) * (tile_h + GUTTER)
    canvas.paste((0, 0, 0), (x - pad + SHADOW_OFFSET[0], y - pad + SHADOW_OFFSET[1]),
                 shadow)
    tile = center_crop_to(Image.open(src).convert('RGB'), tile_w, tile_h)
    canvas.paste(tile, (x, y), mask)

canvas.save('index-preview.png', optimize=True)
print(f'index-preview.png written: {W}x{H}, tiles {tile_w}x{tile_h}')
