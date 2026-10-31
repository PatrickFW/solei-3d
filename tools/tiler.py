# Build static site data for the solei-3d viewer.
import numpy as np, os, json
from PIL import Image
from scipy import ndimage as nd
Image.MAX_IMAGE_PIXELS = None
OUT = '/home/claude/solei-3d/data'
E0, N1, W_M, H_M, CH = 402000, 4610000, 3000, 2000, 128
NCX, NCY = -(-W_M // CH), -(-H_M // CH)
d = np.load('/home/claude/work/mosaic.npz'); models = {'dtm': d['dtm'], 'dsm': d['dsm']}
dr = np.load('/home/claude/work/drain.npz')
HB = 100.0  # height base, cm encoding

def enc_png(h, path):
    v = np.clip(np.round((h - HB) * 100), 0, 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), np.uint8); rgb[..., 0] = v >> 8; rgb[..., 1] = v & 255
    os.makedirs(os.path.dirname(path), exist_ok=True); Image.fromarray(rgb).save(path, optimize=True)

def level_grid(z, res):
    k = int(res / 0.5)
    if k == 1: return z
    h, w = z.shape; return z[:h - h % k, :w - w % k].reshape(h // k, k, w // k, k).mean((1, 3))

def corners(zl, res, x0, y0, nx, ny):
    # bilinear sample of cell-centred grid zl (cell size res) at vertex corners x0+i*res
    xs = (x0 + np.arange(nx + 1) * res) / res - 0.5; ys = (y0 + np.arange(ny + 1) * res) / res - 0.5
    X, Y = np.meshgrid(xs, ys)
    return nd.map_coordinates(zl, [Y, X], order=1, mode='nearest')

LEVELS = [8, 4, 2, 1, 0.5]
meta = {'E0': E0, 'N1': N1, 'W': W_M, 'H': H_M, 'chunk': CH, 'ncx': NCX, 'ncy': NCY, 'levels': LEVELS, 'hbase': HB}
for name, z in models.items():
    for L, res in enumerate(LEVELS):
        zl = level_grid(z, res)
        if L == 0:
            enc_png(corners(zl, res, 0, 0, int(W_M / res), int(H_M / res)), f'{OUT}/h/{name}/overview.png'); continue
        for cy in range(NCY):
            for cx in range(NCX):
                x0, y0 = cx * CH, cy * CH; w = min(CH, W_M - x0); h = min(CH, H_M - y0)
                enc_png(corners(zl, res, x0, y0, int(w / res), int(h / res)), f'{OUT}/h/{name}/{L}/{cx}_{cy}.png')
        print(name, L, 'done', flush=True)
    meta[f'{name}_range'] = [float(np.nanmin(z)), float(np.nanmax(z))]

# collision / info grid: DTM at 2 m, vertex-centred like overview
enc_png(corners(level_grid(models['dtm'], 2), 2, 0, 0, 1500, 1000), f'{OUT}/h/dtm2m.png')

# imagery
def mosaic(folder, prefix, ext, px_per_500):
    s = px_per_500; im = Image.new('RGB', (6 * s, 4 * s))
    for e in range(402000, 405000, 500):
        for n in range(4608000, 4610000, 500):
            t = Image.open(f'/home/claude/work/{folder}/{prefix}_{e}_{n}.{ext}').convert('RGB')
            im.paste(t, ((e - 402000) // 500 * s, (4610000 - n - 500) // 500 * s))
    return im
ortho = mosaic('ortho', 'o', 'jpg', 2000)   # 0.25 m
topo = mosaic('topo', 't', 'png', 1000)     # 0.5 m
os.makedirs(f'{OUT}/t', exist_ok=True)
ortho.resize((1500, 1000), Image.LANCZOS).save(f'{OUT}/t/ortho_overview.jpg', quality=85)
topo.resize((3000, 2000), Image.LANCZOS).save(f'{OUT}/t/topo_overview.jpg', quality=88)
for cy in range(NCY):
    for cx in range(NCX):
        x0, y0 = cx * CH, cy * CH; w = min(CH, W_M - x0); h = min(CH, H_M - y0)
        for tag, im, ppm, sizes in [('ortho', ortho, 4, {1: 2, 2: 4}), ('topo', topo, 2, {1: 2})]:
            crop = im.crop((x0 * ppm, y0 * ppm, (x0 + w) * ppm, (y0 + h) * ppm))
            for T, p in sizes.items():
                os.makedirs(f'{OUT}/t/{tag}/{T}', exist_ok=True)
                c = crop.resize((w * p, h * p), Image.LANCZOS) if p != ppm else crop
                c.save(f'{OUT}/t/{tag}/{T}/{cx}_{cy}.jpg', quality=80 if tag == 'ortho' else 85)
print('imagery done', flush=True)

# drainage: log accumulation (8 bit) and flow direction code, 1 m
acc = dr['acc']; la = np.clip(np.log10(np.maximum(acc, 1)) * 40, 0, 255).astype(np.uint8)
Image.fromarray(la).save(f'{OUT}/acc.png', optimize=True)
codes = {64: 1, 128: 2, 1: 3, 2: 4, 4: 5, 8: 6, 16: 7, 32: 8}  # N NE E SE S SW W NW
fd = dr['fdir']; fc = np.zeros(fd.shape, np.uint8)
for k, v in codes.items(): fc[fd == k] = v
Image.fromarray(fc * 30).save(f'{OUT}/fdir.png', optimize=True)
sl = dr['slope']; sl2 = np.nan_to_num(sl.reshape(1000, 2, 1500, 2).mean((1, 3)))
Image.fromarray(np.clip(sl2 * 3, 0, 255).astype(np.uint8)).save(f'{OUT}/slope.png', optimize=True)
json.dump(meta, open(f'{OUT}/meta.json', 'w'))
print('all done')
