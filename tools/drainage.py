# Drainage from bare-ground model at 1 m: filled DEM, D8 flow direction, accumulation, slope.
import numpy as np, rasterio
from rasterio.transform import from_origin
from pysheds.grid import Grid
if not hasattr(np, "in1d"): np.in1d = np.isin
d = np.load('/home/claude/work/mosaic.npz'); dtm = d['dtm']
z = dtm.reshape(2000, 2, 3000, 2).mean((1, 3)).astype(np.float64)  # 1 m
nodata = -9999.0; z = np.where(np.isfinite(z), z, nodata)
tr = from_origin(402000, 4610000, 1, 1)
with rasterio.open('/tmp/dtm1.tif', 'w', driver='GTiff', width=3000, height=2000, count=1, dtype='float64', crs='EPSG:25831', transform=tr, nodata=nodata) as w: w.write(z, 1)
grid = Grid.from_raster('/tmp/dtm1.tif'); dem = grid.read_raster('/tmp/dtm1.tif')
pf = grid.fill_pits(dem); fl = grid.fill_depressions(pf); inf = grid.resolve_flats(fl)
dirmap = (64, 128, 1, 2, 4, 8, 16, 32)
fdir = grid.flowdir(inf, dirmap=dirmap); acc = grid.accumulation(fdir, dirmap=dirmap)
fdir = np.asarray(fdir); acc = np.asarray(acc)
zz = np.where(z == nodata, np.nan, z); dy, dx = np.gradient(zz, 1.0); slope = np.degrees(np.arctan(np.hypot(dx, dy)))
np.savez_compressed('/home/claude/work/drain.npz', fdir=fdir.astype(np.int16), acc=acc.astype(np.float32), slope=slope.astype(np.float32), filldepth=(np.asarray(fl) - z).astype(np.float32))
print('acc max m2', acc.max(), 'cells>1ha', (acc > 10000).sum())
