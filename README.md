<!-- Generated: 2026-10-31 19:25 CET · Updated: 2026-11-02 18:10 CET -->
# Solei 3D: Castellbell i el Vilar terrain model

A 3D model of the area covered by ICGC 1:5,000 sheet (Solell de la Barraca, Torrent del Tortuguer, Solell dels Abadals), built from ICGC airborne LiDAR. It opens in a phone or desktop browser.

## What it covers
- Block: UTM 31N (ETRS89) E 402,000 to 405,000, N 4,608,000 to 4,610,000 (3 x 2 km). This includes the whole map sheet plus a margin to the east (C-55, Llobregat side).
- Terrain detail: 0.5 m grid near the camera, coarser further away.
- Ground model: LiDAR points in ICGC classes 2, 8 and 75, averaged per 0.5 m cell. All three classes lie on the ground surface; classes 8 and 75 carry most of the terrace walls and steep faces. Remaining gaps, mostly under dense pines, are filled by interpolation with no extra smoothing, so wall steps stay sharp.
- Full 0.5 m detail is shown within about 190 m of the camera. Measure, tap readings and walking use the 0.5 m ground where it is loaded.
- Trees model: highest LiDAR return per 0.5 m cell (trees, buildings, walls). Inside the footprints of the modelled buildings it is flattened to bare ground, so those buildings come only from the building meshes below.
- Buildings: the 26 isolated buildings (small clusters, not the village) are modelled as their own mesh in both Ground and Trees modes. Walls follow the cadastral outline from the ground up to the roof; roofs are triangulated from the LiDAR building returns (class 6, 0.5 m grid, about 1 m on large roofs) and coloured from the photo. Six cadastral footprints have almost no building returns and are left out.

## Controls
- **Photo / Map / Relief**: ICGC 15 cm orthophoto from the 2021-2023 LiDAR flight, ICGC topographic map, or shaded relief.
- **Ground / Trees**: bare-earth model or surface with vegetation and buildings.
- **Buildings**: show or hide the building meshes. Tap a building for eaves and ridge height above the ground, highest point above sea level and footprint.
- **Water**: computed flow lines. The slider sets the minimum area draining into a line.
- **Slope**: green under 5°, yellow 5 to 15°, orange 15 to 30°, red over 30°.
- **Fly**: one finger pans, two fingers rotate, tilt and zoom.
- **Walk**: left half of the screen moves, right half looks. Walking always uses the bare-ground model. On desktop use WASD or the arrow keys plus mouse drag; hold Shift to go faster.
- **Tap a point**: ground level, slope, area draining to it, UTM coordinates. From there you can show its upstream catchment or start walking.
- **Measure**: tap point A, then point B. The panel shows:
  - the height difference and the map (horizontal) distance;
  - the straight 3D distance and the average gradient;
  - the distance over the ground along the line, the total climb and drop along it, and its highest and lowest points;
  - a ground profile.

  Heights are bare-ground levels from the LiDAR model, accurate to about ±0.15 m on open ground and less certain under dense pines. A third tap starts a new measurement.
- **1x / 1.5x / 2x**: vertical exaggeration.

## Drainage method and limits
- Bare-ground model resampled to 1 m. Pits and depressions are filled, then D8 flow direction and flow accumulation are computed (pysheds).
- Culverts are not in the data. Where water passes under a road or track, the model sees the embankment and routes water over it after filling. Check flow lines at road crossings on site.
- Catchments are clipped at the edge of the 3 x 2 km block. The Torrent del Tortuguer and other streams entering from the west and north have larger real catchments. The app flags when a catchment touches the edge.
- Flow lines show where water concentrates on the ground surface. They do not model infiltration, soil or rainfall intensity.

## Data
- ICGC Territorial LiDAR, 3rd coverage (2021-2023), 1 x 1 km LAZ tiles 402608, 402609, 403608, 403609, 404608, 404609. The raw tiles are kept locally, not in this repository.
- ICGC RGB orthophoto, 15 cm, taken during the LiDAR flight (2021-2023), read by window from the Catalonia-wide GeoPackage `lidar-territorial-v3r0-ortofoto-rgb-15cm-2021-2023.gpkg`. Tiles are 12.5 cm (level 4), 25 cm and 50 cm; the photo drapes line up with the LiDAR surface to within about 0.5 m.
- ICGC topographic base map (WMS `mapa-base/topografic`).
- Building outlines: Dirección General del Catastro, INSPIRE Buildings (Castellbell i el Vilar and Sant Vicenç de Castellet municipal downloads), EPSG:25831. Roof shapes come from the LiDAR above.
- All ICGC data: CC BY 4.0, Institut Cartogràfic i Geològic de Catalunya. Cadastre data: Dirección General del Catastro (open data, reuse with attribution).
- Viewer: three.js r170 (MIT), vendored in `lib/`.

## Layout
- `index.html`, `app.js`: viewer.
- `data/h/{dtm,dsm}/{level}/{cx}_{cy}.png`: heights per 128 m chunk. Levels 1 to 4 are 4, 2, 1 and 0.5 m. Encoding: height = 100 + (R x 256 + G) / 100 m.
- `data/h/*/overview.png` (8 m) and `data/h/dtm2m.png` (2 m, used for walking and tap readings).
- `data/t/`: orthophoto (`ortho/1` 50 cm, `ortho/2` 25 cm, `ortho/3` 12.5 cm per pixel) and map imagery per chunk, plus overviews.
- `data/b/buildings.json` and `buildings.bin`: building meshes (positions in 1 cm steps from a per-building origin, roof vertex colours, indices). Layout is described in the json.
- `tools/`: `make_ortho15.py` (photo tiles from the 15 cm chunks), `bake_buildings.py` (building meshes from the cadastre outlines, LiDAR roof grids and photo), `clean_dsm.py` (flatten the Trees surface under modelled buildings).
- `data/acc.png`: flow accumulation, log10(m²) x 40. `data/accd.png` is the same, widened for display. `data/fdir.png`: D8 direction code x 30. `data/slope.png`: degrees x 3 at 2 m.
