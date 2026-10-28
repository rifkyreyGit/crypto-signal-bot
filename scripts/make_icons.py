"""Buat ikon app (PWA/iOS) di public/. Jalankan: python scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'public'
S = 1024
img = Image.new('RGB', (S, S), '#0b0f14')
d = ImageDraw.Draw(img)
# grafik naik dengan breakout
pts = [(180, 700), (330, 560), (450, 640), (600, 430), (700, 500), (840, 280)]
d.line(pts, fill='#22c58b', width=64, joint='curve')
for x, y in pts[1:-1]:
    d.ellipse((x - 32, y - 32, x + 32, y + 32), fill='#22c58b')
# kepala panah
d.polygon([(880, 230), (720, 250), (860, 390)], fill='#22c58b')
# garis resistance putus-putus
for x in range(170, 700, 70):
    d.line([(x, 430), (x + 38, 430)], fill='#4c9dff', width=22)
for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    img.resize((size, size), Image.LANCZOS).save(OUT / name)
