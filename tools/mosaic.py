# Mosaic 1 km grids into one 0.5 m DTM/DSM over E402000-405000, N4608000-4610000, fill gaps.
import numpy as np, glob, os
from scipy import ndimage as nd
E0, N1, R = 402000, 4610000, 0.5
W, H = 6000, 4000
G = np.full((H, W), np.nan, np.float32); S = np.full((H, W), np.nan, np.float32); C = np.zeros((H, W), np.uint16)
for f in sorted(glob.glob('/mnt/user-data/uploads/solei-3d/grids/g*.npz')):
    t = os.path.basename(f)[1:7]; e = int(t[:3]) * 1000; n = 4000000 + int(t[3:]) * 1000
    c0 = int((e - E0) / R); r0 = int((N1 - (n + 1000)) / R)
    d = np.load(f); G[r0:r0+2000, c0:c0+2000] = d['ground']; S[r0:r0+2000, c0:c0+2000] = d['surface']; C[r0:r0+2000, c0:c0+2000] = d['gcount']
    print('tile', t, r0, c0)
have = np.isfinite(S)
def nanfill(a):
    a = a.copy(); m = np.isfinite(a)
    if m.all(): return a
    h, w = a.shape
    if min(h, w) <= 2:
        a[~m] = np.nanmean(a) if m.any() else 0; return a
    hp, wp = h + h % 2, w + w % 2
    p = np.full((hp, wp), np.nan, np.float32); p[:h, :w] = a
    blk = p.reshape(hp//2, 2, wp//2, 2)
    with np.errstate(invalid='ignore'):
        cnt = np.isfinite(blk).sum((1, 3)); sm = np.nansum(blk, (1, 3))
        low = np.where(cnt > 0, sm / np.maximum(cnt, 1), np.nan).astype(np.float32)
    low = nanfill(low)
    up = nd.zoom(low, 2, order=1, mode='nearest')[:h, :w]
    a[~m] = up[~m]; return a
# remove ground spikes (misclassified points): >4 m above local median of ground
med = nd.generic_filter(np.nan_to_num(G, nan=-9999), lambda v: np.median(v[v > -9000]) if (v > -9000).sum() > 4 else -9999, size=5) if False else None
Gf = nanfill(G)
loc = nd.median_filter(Gf, size=7)
spike = np.isfinite(G) & (G - loc > 4)
print('ground spikes', spike.sum())
G2 = G.copy(); G2[spike] = np.nan
Gf = nanfill(G2)
# smooth only interpolated cells a little
sm = nd.gaussian_filter(Gf, 1.0)
Gf = np.where(np.isfinite(G2), Gf, sm).astype(np.float32)
Sf = nanfill(S)
locS = nd.median_filter(Sf, size=3)
Sf = np.where(Sf - locS > 15, locS, Sf)
Sf = np.maximum(Sf, Gf).astype(np.float32)
# all tiles present: no masking
np.savez_compressed('/home/claude/work/mosaic.npz', dtm=Gf, dsm=Sf, have=have)
print('done', np.isfinite(Gf).mean(), np.nanmin(Gf), np.nanmax(Gf))
