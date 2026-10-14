"""Compose the six chapter stills into a single contact sheet.

Left column: the six chapters at 1600x900.
Right strip: the same piece on a 390x844 phone, showing the mobile layout.
"""
import os
from PIL import Image, ImageDraw

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shots")
BASE = os.path.abspath(BASE)
OUT = os.path.join(BASE, "contact-sheet.png")

CHAPTERS = [
    ("01-overview.png",      "00", "细胞全景",   "THE CELL"),
    ("02-membrane.png",      "01", "细胞膜",     "PLASMA MEMBRANE"),
    ("03-nucleus.png",       "02", "细胞核",     "NUCLEUS"),
    ("04-mitochondrion.png", "03", "线粒体",     "MITOCHONDRION"),
    ("05-protein.png",       "04", "蛋白流水线", "PROTEIN HIGHWAY"),
    ("06-mitosis.png",       "05", "有丝分裂",   "MITOSIS"),
]
PHONE = ["phone-membrane.png", "phone-mitosis.png"]

BG = (4, 6, 14)
CELL_W = 700
PAD = 14
LABEL_H = 40
PHONE_H = 620            # phone column height

tiles = []
for fn, idx, cn, en in CHAPTERS:
    im = Image.open(os.path.join(BASE, fn)).convert("RGB")
    h = round(im.height * CELL_W / im.width)
    tiles.append((im.resize((CELL_W, h), Image.LANCZOS), idx, cn, en))
cell_h = tiles[0][0].height

phones = []
for fn in PHONE:
    im = Image.open(os.path.join(BASE, fn)).convert("RGB")
    w = round(im.width * PHONE_H / im.height)
    phones.append(im.resize((w, PHONE_H), Image.LANCZOS))
phone_col_w = max(p.width for p in phones)

cols_w = 2 * CELL_W + phone_col_w
W = cols_w + 4 * PAD
H = 3 * (cell_h + LABEL_H) + 4 * PAD

sheet = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(sheet)

# left: 2 x 3 grid of desktop stills
for i, (im, idx, cn, en) in enumerate(tiles):
    c, r = i % 2, i // 2
    x = PAD + c * (CELL_W + PAD)
    y = PAD + r * (cell_h + LABEL_H + PAD)
    sheet.paste(im, (x, y))
    draw.rectangle([x, y, x + CELL_W - 1, y + cell_h - 1], outline=(24, 46, 66))
    ty = y + cell_h + 8
    draw.text((x + 2, ty), f"{idx}  {cn}", fill=(180, 225, 245))
    draw.text((x + 2, ty + 18), en, fill=(72, 108, 134))

# right: phone column, centred vertically
x0 = PAD + 2 * (CELL_W + PAD)
total = sum(p.height for p in phones) + PAD * (len(phones) - 1)
y = max(PAD, (H - total) // 2)
for p in phones:
    px = x0 + (phone_col_w - p.width) // 2
    sheet.paste(p, (px, y))
    draw.rectangle([px, y, px + p.width - 1, y + p.height - 1], outline=(24, 46, 66))
    y += p.height + PAD

draw.text((x0 + 2, PAD // 2 + 2), "手机布局 · MOBILE", fill=(72, 108, 134))

sheet.save(OUT)
print(f"wrote {OUT}  {sheet.width}x{sheet.height}")
