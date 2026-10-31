# Rasterise one ICGC LAZ tile to 0.5 m grids: ground mean, ground count, surface max.
import sys, numpy as np, laspy
f, e0, n0 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
R = 0.5; W = int(1000 / R)
gsum = np.zeros(W*W); gcnt = np.zeros(W*W, np.uint32); smax = np.full(W*W, -1e9, np.float32)
with laspy.open(f) as fh:
    for ch in fh.chunk_iterator(4_000_000):
        x = np.asarray(ch.x); y = np.asarray(ch.y); z = np.asarray(ch.z, np.float32)
        c = np.asarray(ch.classification)
        try: wh = np.asarray(ch.withheld, bool)
        except Exception: wh = np.zeros(len(c), bool)
        i = ((x - e0) / R).astype(np.int64); j = ((n0 + 1000 - y) / R).astype(np.int64)
        ok = (i >= 0) & (i < W) & (j >= 0) & (j < W) & ~wh & (c != 7) & (c != 18)
        idx = j[ok] * W + i[ok]; zz = z[ok]; cc = c[ok]
        g = (cc == 2) | (cc == 8) | (cc == 75)  # ICGC: 8 and 75 also lie on the ground (terrace walls, steep faces)
        gsum += np.bincount(idx[g], weights=zz[g], minlength=W*W)
        gcnt += np.bincount(idx[g], minlength=W*W).astype(np.uint32)
        o = np.argsort(idx, kind='stable'); si = idx[o]; sz = zz[o]
        if len(si):
            starts = np.r_[0, np.nonzero(np.diff(si))[0] + 1]
            m = np.maximum.reduceat(sz, starts); u = si[starts]
            smax[u] = np.maximum(smax[u], m)
        del x, y, z, c
gm = np.where(gcnt > 0, gsum / np.maximum(gcnt, 1), np.nan).astype(np.float32)
smax[smax < -1e8] = np.nan
out = sys.argv[4]
np.savez_compressed(out, ground=gm.reshape(W, W), gcount=np.minimum(gcnt, 65535).astype(np.uint16).reshape(W, W), surface=smax.reshape(W, W))
print('ok', out, np.isfinite(gm).mean(), np.nanmin(gm), np.nanmax(gm))
