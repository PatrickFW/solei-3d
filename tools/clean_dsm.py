# Flatten the "Trees" surface (data/h/dsm) to bare ground inside every modelled building footprint,
# so the roofs and walls come only from data/b (bake_buildings.py) and do not fight the old ragged LiDAR roofs.
# usage: clean_dsm.py REPO WORK_DIR_WITH_bu_block.json   (idempotent; only footprints present in data/b/buildings.json)
import sys, json, os
import numpy as np
from PIL import Image
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union
REPO, WORK = sys.argv[1], sys.argv[2]
E0, N1, W, H, CH, BUF = 402000, 4610000, 3000, 2000, 128, 0.8
baked = {b["id"] for b in json.load(open(f"{REPO}/data/b/buildings.json"))["buildings"]}
polys = []
for b in json.load(open(f"{WORK}/bu_block.json")):
    if b["id"] not in baked: continue
    ext = [[(x - E0, N1 - y) for x, y in r[1]] for r in b["rings"] if r[0] == "e"]
    inn = [[(x - E0, N1 - y) for x, y in r[1]] for r in b["rings"] if r[0] == "i"]
    p = Polygon(ext[0], inn)
    polys.append((p if p.is_valid else p.buffer(0)).buffer(BUF))
U = unary_union(polys); shapely.prepare(U)
res = {1: 4.0, 2: 2.0, 3: 1.0, 4: 0.5}
n_chunks = 0
for L, r in res.items():
    for cx in range(24):
        for cy in range(16):
            x0, z0 = cx * CH, cy * CH
            if not U.intersects(shapely.box(x0 - 1, z0 - 1, x0 + CH + 1, z0 + CH + 1)): continue
            pd, pg = f"{REPO}/data/h/dsm/{L}/{cx}_{cy}.png", f"{REPO}/data/h/dtm/{L}/{cx}_{cy}.png"
            a = np.asarray(Image.open(pd).convert("RGB")).copy(); g = np.asarray(Image.open(pg).convert("RGB"))
            h, w = a.shape[:2]
            xs = x0 + np.arange(w) * r; zs = z0 + np.arange(h) * r
            X, Z = np.meshgrid(xs, zs); m = shapely.contains_xy(U, X, Z)
            if not m.any(): continue
            a[m] = g[m]; n_chunks += 1
            Image.fromarray(a).save(pd, optimize=True)
    print("level", L, "done", n_chunks, flush=True)
