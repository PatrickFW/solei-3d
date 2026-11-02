# Build the viewer's orthophoto tiles from the ICGC 15 cm LiDAR-flight orthophoto chunks (128 m each, 0.15 m/px).
# usage: make_ortho15.py REPO CHUNK_DIR     -> data/t/ortho/{1,2,3}/{cx}_{cy}.jpg and data/t/ortho_overview.jpg
import os, sys
from PIL import Image
REPO, SRC = sys.argv[1], sys.argv[2]
W, H, CH = 3000, 2000, 128
levels = {1: (2, 86), 2: (4, 86), 3: (8, 84)}          # level: (pixels per metre, JPEG quality)
for L in levels: os.makedirs(f"{REPO}/data/t/ortho/{L}", exist_ok=True)
ov = Image.new("RGB", (W // 2, H // 2))
for cy in range(16):
    for cx in range(24):
        w, h = min(CH, W - cx * CH), min(CH, H - cy * CH)
        im = Image.open(f"{SRC}/{cx}_{cy}.jpg").convert("RGB")
        for L, (ppm, q) in levels.items():
            im.resize((w * ppm, h * ppm), Image.LANCZOS).save(f"{REPO}/data/t/ortho/{L}/{cx}_{cy}.jpg", quality=q, optimize=True, subsampling=0 if L == 3 else 2)
        ov.paste(im.resize((w // 2, h // 2), Image.LANCZOS), (cx * CH // 2, cy * CH // 2))
ov.save(f"{REPO}/data/t/ortho_overview.jpg", quality=88, optimize=True)
print("done")
