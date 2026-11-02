# Bake building meshes for the viewer.
# Inputs : tools15/bu_block.json (cadastre footprints, EPSG:25831), roofs.npz (LiDAR class 6 roof grids, 0.5 m),
#          data/h/dtm/4 (0.5 m ground), a folder of ortho chunk JPEGs (128 m each, any resolution).
# Outputs: data/b/buildings.json (meta) and data/b/buildings.bin (typed arrays, see LAYOUT in the json).
import json, sys, os, math
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import Delaunay
import shapely
from shapely.geometry import Polygon, LinearRing

REPO = sys.argv[1]; WORK = sys.argv[2]; ORTHO = sys.argv[3]
E0, N1, W, H, CH, YOFF = 402000, 4610000, 3000, 2000, 128, 150.0
R = 0.5
B = json.load(open(f"{WORK}/bu_block.json"))
RF = np.load(f"{WORK}/roofs.npz")

# ---------- ground sampler (0.5 m DTM chunks) ----------
_dtm = {}
def dtm_chunk(cx, cy):
    k = (cx, cy)
    if k not in _dtm:
        p = f"{REPO}/data/h/dtm/4/{cx}_{cy}.png"
        if os.path.exists(p):
            a = np.asarray(Image.open(p).convert("RGB"), np.float32)
            _dtm[k] = 100.0 + (a[:, :, 0] * 256 + a[:, :, 1]) / 100.0
        else: _dtm[k] = None
    return _dtm[k]
def ground(x, z):
    x = np.clip(np.asarray(x, float), 0, W - 1e-6); z = np.clip(np.asarray(z, float), 0, H - 1e-6)
    out = np.zeros(x.shape)
    cx = (x // CH).astype(int); cy = (z // CH).astype(int)
    for k in set(zip(cx.tolist(), cy.tolist())):
        m = (cx == k[0]) & (cy == k[1]); g = dtm_chunk(*k)
        fx = (x[m] - k[0] * CH) / 0.5; fz = (z[m] - k[1] * CH) / 0.5
        out[m] = ndi.map_coordinates(g, [fz, fx], order=1, mode="nearest")
    return out

# ---------- colour sampler ----------
_img = {}; _blur = {}
def colour(x, z, sigma_m=0.0):
    """Photo colour at scene metres; sigma_m averages the photo over about one mesh cell so sparse vertices do not alias roof ribs."""
    x = np.clip(np.asarray(x, float), 0, W - 1e-6); z = np.clip(np.asarray(z, float), 0, H - 1e-6)
    out = np.zeros(x.shape + (3,), np.float32)
    cx = (x // CH).astype(int); cy = (z // CH).astype(int)
    for k in set(zip(cx.tolist(), cy.tolist())):
        m = (cx == k[0]) & (cy == k[1])
        if k not in _img:
            p = f"{ORTHO}/{k[0]}_{k[1]}.jpg"
            _img[k] = np.asarray(Image.open(p).convert("RGB"), np.float32) if os.path.exists(p) else None
        a = _img[k]
        if a is None: out[m] = (120, 110, 100); continue
        h, w = a.shape[:2]; sx = w / min(CH, W - k[0] * CH); sz = h / min(CH, H - k[1] * CH)
        if sigma_m > 0:
            ck = (k, sigma_m)
            if ck not in _blur: _blur[ck] = np.dstack([ndi.gaussian_filter(a[:, :, c], sigma_m * sx, mode="nearest") for c in range(3)])
            a = _blur[ck]
        fx = (x[m] - k[0] * CH) * sx - 0.5; fz = (z[m] - k[1] * CH) * sz - 0.5
        for ch in range(3): out[m, ch] = ndi.map_coordinates(a[:, :, ch], [fz, fx], order=1, mode="nearest")
    return out

def densify(ring, step):
    pts = []
    for (x0, z0), (x1, z1) in zip(ring[:-1], ring[1:]):
        n = max(1, int(math.ceil(math.hypot(x1 - x0, z1 - z0) / step)))
        for t in range(n): pts.append((x0 + (x1 - x0) * t / n, z0 + (z1 - z0) * t / n))
    return pts

# Only isolated buildings are modelled: footprints within CLUSTER_GAP m of each other form a cluster, clusters of more
# than MAX_CLUSTER buildings (the village) are left to the terrain surface model.
from shapely.ops import unary_union
CLUSTER_GAP, MAX_CLUSTER = 7.5, 3
_fp = []
for _b in B:
    _e = [[(x - E0, N1 - y) for x, y in r[1]] for r in _b["rings"] if r[0] == "e"]
    _p = Polygon(_e[0]); _fp.append(_p if _p.is_valid else _p.buffer(0))
_u = unary_union([p_.buffer(CLUSTER_GAP) for p_ in _fp])
_comps = list(_u.geoms) if _u.geom_type == "MultiPolygon" else [_u]
_town = set()
for _c in _comps:
    _in = [i for i, p_ in enumerate(_fp) if _c.contains(p_.centroid)]
    if len(_in) > MAX_CLUSTER: _town.update(_in)
print("town buildings left out:", len(_town), "of", len(B))
meta = []; RP = []; RC = []; RI = []; WP = []; WI = []
rv = 0; wv = 0; skipped = []
for bi, b in enumerate(B, 1):
    key = f"h{bi}"
    if bi - 1 in _town: continue
    if key not in RF.files: skipped.append((b["id"], "no roof points")); continue
    ext = [[(x - E0, N1 - y) for x, y in r[1]] for r in b["rings"] if r[0] == "e"]
    inn = [[(x - E0, N1 - y) for x, y in r[1]] for r in b["rings"] if r[0] == "i"]
    poly = Polygon(ext[0], inn)
    if not poly.is_valid: poly = poly.buffer(0)
    if poly.geom_type != "Polygon" or poly.is_empty: skipped.append((b["id"], "bad polygon")); continue
    cxm, czm = poly.centroid.x, poly.centroid.y
    if not (0 <= cxm < W and 0 <= czm < H): skipped.append((b["id"], "outside block")); continue
    roof = RF[key]; r0, c0 = RF[f"o{bi}"]
    # LiDAR height noise (about 0.1 m) makes smooth shading blotchy; smooth more on large, mostly flat roofs
    roof = ndi.gaussian_filter(roof, 2.0 if poly.area > 600 else 0.8, mode="nearest")
    def roof_z(x, z):
        return ndi.map_coordinates(roof, [(np.asarray(z) / R - 0.5) - r0, (np.asarray(x) / R - 0.5) - c0], order=1, mode="nearest")
    area = poly.area
    s = 0.5 if area < 600 else (0.75 if area < 3000 else 1.5)
    rings = [list(poly.exterior.coords)] + [list(i.coords) for i in poly.interiors]
    bpts = []; ring_idx = []
    for rg in rings:
        d = densify(rg, s); ring_idx.append((len(bpts), len(bpts) + len(d))); bpts += d
    bpts = np.array(bpts)
    # interior grid, kept away from the outline so no slivers
    minx, minz, maxx, maxz = poly.bounds
    gx, gz = np.meshgrid(np.arange(minx + s / 2, maxx, s), np.arange(minz + s / 2, maxz, s))
    gp = np.c_[gx.ravel(), gz.ravel()]
    inner = poly.buffer(-0.6 * s)
    ip = gp[shapely.contains_xy(inner, gp[:, 0], gp[:, 1])] if not inner.is_empty else np.zeros((0, 2))
    pts = np.vstack([bpts, ip])
    if len(pts) < 4: skipped.append((b["id"], "too small")); continue
    try: tri = Delaunay(pts)
    except Exception as e: skipped.append((b["id"], f"delaunay {e}")); continue
    S = tri.simplices; P = pts[S]                       # (nt,3,2)
    cen = P.mean(1)
    pb = poly.buffer(0.05)
    keep = shapely.contains_xy(pb, cen[:, 0], cen[:, 1])
    for a_, b_ in ((0, 1), (1, 2), (2, 0)):
        mid = (P[:, a_] + P[:, b_]) / 2; keep &= shapely.contains_xy(pb, mid[:, 0], mid[:, 1])
    S = S[keep]
    if len(S) == 0: skipped.append((b["id"], "no triangles")); continue
    zr = roof_z(pts[:, 0], pts[:, 1])
    zg = ground(bpts[:, 0], bpts[:, 1])
    # roof vertices
    col = colour(pts[:, 0], pts[:, 1], s * 0.5)
    pos = np.c_[pts[:, 0], zr - YOFF, pts[:, 1]]
    nrm = np.cross(pos[S[:, 1]] - pos[S[:, 0]], pos[S[:, 2]] - pos[S[:, 0]])
    flip = nrm[:, 1] < 0; S[flip] = S[flip][:, [0, 2, 1]]
    # walls
    nb = len(bpts); bot = np.c_[bpts[:, 0], zg - 0.5 - YOFF, bpts[:, 1]]
    top = pos[:nb].copy(); top[:, 1] = np.maximum(top[:, 1], zg - YOFF + 0.3)   # never below the ground
    pos[:nb, 1] = top[:, 1]                                                       # roof rim follows wall top
    wpos = np.vstack([top, bot]); wtri = []
    for (a, e) in ring_idx:
        n = e - a
        for k in range(n):
            i0 = a + k; i1 = a + (k + 1) % n
            dx, dz = bpts[i1] - bpts[i0]
            L = math.hypot(dx, dz)
            if L < 1e-6: continue
            nx_, nz_ = dz / L, -dx / L
            mp = (bpts[i0] + bpts[i1]) / 2 + 0.05 * np.array([nx_, nz_])
            outward = not poly.contains(shapely.Point(*mp))
            q = [i0, i0 + nb, i1 + nb, i1]
            if outward: wtri += [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]
            else:       wtri += [[q[0], q[2], q[1]], [q[0], q[3], q[2]]]
    wtri = np.array(wtri, np.int64)
    # stats
    eaves = float(np.median(top[:, 1] + YOFF - zg)); gmed = float(np.median(zg))
    ridge = float(np.percentile(zr, 99.5) - gmed)
    origin = np.array([pos[:, 0].min(), min(pos[:, 1].min(), bot[:, 1].min()), pos[:, 2].min()])
    q16 = lambda a: np.round((a - origin) * 100).astype(np.int64)
    rq = q16(pos); wq = q16(wpos)
    if rq.max() > 65535 or wq.max() > 65535: skipped.append((b["id"], "too large for uint16")); continue
    RP.append(rq.astype(np.uint16)); RC.append(np.clip(col, 0, 255).astype(np.uint8)); RI.append((S + rv).astype(np.uint32))
    WP.append(wq.astype(np.uint16)); WI.append((wtri + wv).astype(np.uint32))
    meta.append(dict(id=b["id"], o=[round(float(v), 2) for v in origin], rv=rv, rn=len(pos), rt=len(S), wv=wv, wn=len(wpos), wt=len(wtri),
                     area=round(area), eaves=round(eaves, 1), ridge=round(ridge, 1), ground=round(gmed, 1), cover=round(float(RF[f'cover{bi}']) if f'cover{bi}' in RF.files else -1, 2)))
    rv += len(pos); wv += len(wpos)

os.makedirs(f"{REPO}/data/b", exist_ok=True)
arrs = [np.concatenate(RP).ravel(), np.concatenate(RC).ravel(), np.concatenate(RI).ravel(), np.concatenate(WP).ravel(), np.concatenate(WI).ravel()]
names = ["roofPos:u16x3", "roofCol:u8x3", "roofIdx:u32", "wallPos:u16x3", "wallIdx:u32"]
layout = []; off = 0
with open(f"{REPO}/data/b/buildings.bin", "wb") as f:
    for n_, a in zip(names, arrs):
        pad = (-off) % 4                       # typed-array views need 4-byte aligned offsets
        f.write(b"\0" * pad); off += pad
        f.write(a.tobytes()); layout.append(dict(name=n_.split(":")[0], type=n_.split(":")[1], offset=off, count=int(a.size))); off += a.nbytes
json.dump(dict(yoff=YOFF, scale=0.01, layout=layout, buildings=meta), open(f"{REPO}/data/b/buildings.json", "w"), separators=(",", ":"))
print("buildings", len(meta), "skipped", len(skipped), skipped[:12])
print("roof verts", rv, "tris", sum(m["rt"] for m in meta), "wall verts", wv, "tris", sum(m["wt"] for m in meta), "bin MB", off / 1e6)
