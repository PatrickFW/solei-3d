<!-- Generated: 2026-10-31 19:25 CET -->
# Solei 3D: Castellbell i el Vilar terrain model

A 3D model of the area covered by ICGC 1:5,000 sheet (Solell de la Barraca, Torrent del Tortuguer, Solell dels Abadals), built from ICGC airborne LiDAR. It opens in a phone or desktop browser.

## What it covers
- Block: UTM 31N (ETRS89) E 402,000 to 405,000, N 4,608,000 to 4,610,000 (3 x 2 km). This includes the whole map sheet plus a margin to the east (C-55, Llobregat side).
- Terrain detail: 0.5 m grid near the camera, coarser further away.
- Ground model: LiDAR ground points (class 2), averaged per 0.5 m cell. Gaps under dense pines are filled by interpolation.
- Trees model: highest LiDAR return per 0.5 m cell (trees, buildings, walls).

## Controls
- **Photo / Map / Relief**: 2021-2023 ICGC orthophoto (25 cm), ICGC topographic map, or shaded relief.
- **Ground / Trees**: bare-earth model or surface with vegetation and buildings.
- **Water**: computed flow lines. The slider sets the minimum area draining into a line.
- **Slope**: green under 5°, yellow 5 to 15°, orange 15 to 30°, red over 30°.
- **Fly**: one finger pans, two fingers rotate, tilt and zoom.
- **Walk**: left half of the screen moves, right half looks. Walking always uses the bare-ground model. On desktop use WASD or the arrow keys plus mouse drag; hold Shift to go faster.
- **Tap a point**: ground level, slope, area draining to it, UTM coordinates. From there you can show its upstream catchment or start walking.
- **1x / 1.5x / 2x**: vertical exaggeration.

## Drainage method and limits
- Bare-ground model resampled to 1 m. Pits and depressions are filled, then D8 flow direction and flow accumulation are computed (pysheds).
- Culverts are not in the data. Where water passes under a road or track, the model sees the embankment and routes water over it after filling. Check flow lines at road crossings on site.
- Catchments are clipped at the edge of the 3 x 2 km block. The Torrent del Tortuguer and other streams entering from the west and north have larger real catchments. The app flags when a catchment touches the edge.
- Flow lines show where water concentrates on the ground surface. They do not model infiltration, soil or rainfall intensity.

## Data
- ICGC Territorial LiDAR, 3rd coverage (2021-2023), 1 x 1 km LAZ tiles 402608, 402609, 403608, 403609, 404608, 404609. The raw tiles are kept locally, not in this repository.
- ICGC orthophoto (WMS `ortofoto_color_vigent`) and topographic base map (WMS `mapa-base/topografic`).
- All ICGC data: CC BY 4.0, Institut Cartogràfic i Geològic de Catalunya.
- Viewer: three.js r170 (MIT), vendored in `lib/`.

## Layout
- `index.html`, `app.js`: viewer.
- `data/h/{dtm,dsm}/{level}/{cx}_{cy}.png`: heights per 128 m chunk. Levels 1 to 4 are 4, 2, 1 and 0.5 m. Encoding: height = 100 + (R x 256 + G) / 100 m.
- `data/h/*/overview.png` (8 m) and `data/h/dtm2m.png` (2 m, used for walking and tap readings).
- `data/t/`: orthophoto and map imagery per chunk, plus overviews.
- `data/acc.png`: flow accumulation, log10(m²) x 40. `data/accd.png` is the same, widened for display. `data/fdir.png`: D8 direction code x 30. `data/slope.png`: degrees x 3 at 2 m.
