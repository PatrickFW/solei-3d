// Solei 3D viewer: chunked LOD terrain from ICGC LiDAR (bare ground / with trees),
// photo, map and relief drapes, drainage and slope overlays, tap info, upstream catchment, walk mode.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

const $ = (s) => document.querySelector(s);
const status = (t) => { const el = $('#status'); el.style.display = t ? 'block' : 'none'; if (t) el.textContent = t; };

const meta = await fetch('data/meta.json').then((r) => r.json());
const { W, H, chunk: CH, ncx: NCX, ncy: NCY, levels: LEVELS, hbase: HB } = meta;
const YOFF = 150; // scene y = (height - YOFF) * exag

// ---------- image decoding ----------
async function loadPixels(url) {
  const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.blob(); });
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height); bmp.close?.();
  return d;
}
async function loadHeights(url) {
  const d = await loadPixels(url); const n = d.width * d.height; const h = new Float32Array(n); const p = d.data;
  for (let i = 0; i < n; i++) h[i] = HB + (p[i * 4] * 256 + p[i * 4 + 1]) / 100;
  return { w: d.width, h: d.height, z: h };
}
async function loadGray(url) {
  const d = await loadPixels(url); const n = d.width * d.height; const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = d.data[i * 4];
  return { w: d.width, h: d.height, a };
}
const texLoader = new THREE.TextureLoader();
function loadTex(url, opts = {}) {
  return new Promise((res, rej) => texLoader.load(url, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
    if (opts.nomip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t);
  }, undefined, rej));
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color().setRGB(0.62, 0.71, 0.79, THREE.LinearSRGBColorSpace);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 12000);
const terrain = new THREE.Group(); scene.add(terrain);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- global data ----------
status('Loading terrain…');
const [ovDtm, ground2, accG, fdirG, orthoOv, topoOv, accTex, slopeTex] = await Promise.all([
  loadHeights('data/h/dtm/overview.png'), loadHeights('data/h/dtm2m.png'),
  loadGray('data/acc.png'), loadGray('data/fdir.png'),
  loadTex('data/t/ortho_overview.jpg'), loadTex('data/t/topo_overview.jpg'),
  loadTex('data/accd.png', { nomip: true }), loadTex('data/slope.png', { nomip: true }),
]);
const overview = { dtm: ovDtm, dsm: null };
const catchCanvas = document.createElement('canvas'); catchCanvas.width = 1500; catchCanvas.height = 1000;
const catchTex = new THREE.CanvasTexture(catchCanvas); catchTex.colorSpace = THREE.NoColorSpace; catchTex.generateMipmaps = false; catchTex.minFilter = THREE.LinearFilter;

const U = {
  globalBase: { value: orthoOv }, accTex: { value: accTex }, slopeTex: { value: slopeTex }, catchTex: { value: catchTex },
  mode: { value: 0 }, showDrain: { value: 0 }, drainThr: { value: 3.7 }, showSlope: { value: 0 }, showCatch: { value: 0 },
  sunDir: { value: new THREE.Vector3(-0.5, 0.75, -0.45).normalize() }, hRange: { value: new THREE.Vector2(meta.dtm_range[0], meta.dtm_range[1]) },
  size: { value: new THREE.Vector2(W, H) }, exag: { value: 1 },
};
const vert = `
  varying vec2 vUv; varying vec2 vW; varying vec3 vN; varying float vH;
  uniform float exag;
  void main(){ vUv = uv; vW = position.xz; vN = normal; vH = position.y + ${YOFF.toFixed(1)};
    vec3 p = position; p.y *= exag; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`;
const frag = `
  precision highp float;
  varying vec2 vUv; varying vec2 vW; varying vec3 vN; varying float vH;
  uniform sampler2D baseTex; uniform sampler2D globalBase; uniform float useGlobal;
  uniform sampler2D accTex; uniform sampler2D slopeTex; uniform sampler2D catchTex;
  uniform int mode; uniform float showDrain, drainThr, showSlope, showCatch, exag;
  uniform vec3 sunDir; uniform vec2 hRange; uniform vec2 size;
  void main(){
    vec2 g = vec2(vW.x / size.x, 1.0 - vW.y / size.y);
    vec3 n = normalize(vec3(vN.x, vN.y / exag, vN.z));
    float lam = max(dot(n, sunDir), 0.0);
    vec3 col;
    if (mode == 2) {
      float t = clamp((vH - hRange.x) / (hRange.y - hRange.x), 0.0, 1.0);
      vec3 lo = vec3(0.50,0.62,0.42), mid = vec3(0.86,0.80,0.60), hi = vec3(0.80,0.68,0.58);
      col = t < 0.5 ? mix(lo, mid, t*2.0) : mix(mid, hi, t*2.0-1.0);
      col *= 0.30 + 0.85 * lam;
    } else {
      col = useGlobal > 0.5 ? texture2D(globalBase, g).rgb : texture2D(baseTex, vUv).rgb;
      col *= mix(1.0, 0.55 + 0.6 * lam, mode == 0 ? 0.35 : 0.25);
    }
    if (showSlope > 0.5) {
      float s = texture2D(slopeTex, g).r * 255.0 / 3.0;
      vec3 sc = s < 5.0 ? vec3(0.20,0.70,0.30) : s < 15.0 ? vec3(0.95,0.90,0.20) : s < 30.0 ? vec3(1.0,0.55,0.10) : vec3(0.85,0.10,0.10);
      col = mix(col, sc, 0.42);
    }
    if (showDrain > 0.5) {
      float a = texture2D(accTex, g).r * 255.0 / 40.0;
      float k = smoothstep(drainThr, drainThr + 0.25, a) * clamp(0.55 + (a - drainThr) * 0.35, 0.0, 1.0);
      col = mix(col, vec3(0.08,0.42,1.0), k);
    }
    if (showCatch > 0.5) { float c = texture2D(catchTex, g).a; col = mix(col, vec3(1.0,0.25,0.75), c * 0.5); }
    gl_FragColor = vec4(col, 1.0);
  }`;

// ---------- chunk geometry ----------
function buildGeometry(hgt, x0, z0, res, sub) {
  // hgt: {w,h,z} vertex grid; sub: optional [i0,j0,nx,ny] window into hgt
  const [i0, j0, nx, ny] = sub || [0, 0, hgt.w - 1, hgt.h - 1];
  const vw = nx + 1, vh = ny + 1, nv = vw * vh, nsk = 4 * (nx + ny) + 4;
  const pos = new Float32Array((nv + nsk) * 3), nor = new Float32Array((nv + nsk) * 3), uv = new Float32Array((nv + nsk) * 2);
  const zAt = (i, j) => hgt.z[(j0 + Math.min(Math.max(j, 0), ny)) * hgt.w + i0 + Math.min(Math.max(i, 0), nx)];
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const k = j * vw + i, y = zAt(i, j) - YOFF;
    pos[k * 3] = x0 + i * res; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z0 + j * res;
    const gi = i0 + i, gj = j0 + j; // use neighbours beyond window when available for seamless normals
    const zl = hgt.z[gj * hgt.w + Math.max(gi - 1, 0)], zr = hgt.z[gj * hgt.w + Math.min(gi + 1, hgt.w - 1)];
    const zu = hgt.z[Math.max(gj - 1, 0) * hgt.w + gi], zd = hgt.z[Math.min(gj + 1, hgt.h - 1) * hgt.w + gi];
    const nxv = (zl - zr) / (2 * res), nzv = (zu - zd) / (2 * res), l = Math.hypot(nxv, 1, nzv);
    nor[k * 3] = nxv / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nzv / l;
    uv[k * 2] = i / nx; uv[k * 2 + 1] = 1 - j / ny;
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  // skirts: drop a curtain around the edge to hide cracks between levels of detail
  const skirt = Math.max(2, res * 3); let s = nv;
  const ring = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 0; j < ny; j++) ring.push(j * vw + nx);
  for (let i = nx; i > 0; i--) ring.push(ny * vw + i);
  for (let j = ny; j > 0; j--) ring.push(j * vw);
  ring.push(0);
  for (let r = 0; r < ring.length - 1; r++) {
    const a = ring[r], b = ring[r + 1];
    for (const v of [a, b]) {
      pos[s * 3] = pos[v * 3]; pos[s * 3 + 1] = pos[v * 3 + 1] - skirt; pos[s * 3 + 2] = pos[v * 3 + 2];
      nor[s * 3] = nor[v * 3]; nor[s * 3 + 1] = nor[v * 3 + 1]; nor[s * 3 + 2] = nor[v * 3 + 2];
      uv[s * 2] = uv[v * 2]; uv[s * 2 + 1] = uv[v * 2 + 1]; s++;
    }
    idx.push(a, s - 2, b, b, s - 2, s - 1, a, b, s - 2, b, s - 1, s - 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, s * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, s * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, s * 2), 2));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

// ---------- chunks ----------
const state = { base: 'photo', model: 'dtm', mode: 'orbit', exag: 1 };
const chunks = [];
for (let cy = 0; cy < NCY; cy++) for (let cx = 0; cx < NCX; cx++) {
  const x0 = cx * CH, z0 = cy * CH, w = Math.min(CH, W - x0), h = Math.min(CH, H - z0);
  chunks.push({ cx, cy, x0, z0, w, h, shown: -1, shownKey: '', want: 0, busy: false, mesh: null, tex: null });
}
const hcache = new Map(); // url -> heights, LRU
async function getHeights(url) {
  if (hcache.has(url)) { const v = hcache.get(url); hcache.delete(url); hcache.set(url, v); return v; }
  const v = await loadHeights(url); hcache.set(url, v);
  while (hcache.size > 260) hcache.delete(hcache.keys().next().value);
  return v;
}
function texLevel(L) {
  if (state.base === 'relief') return null;
  if (state.base === 'photo') return L === 0 ? null : (L >= 3 ? 'ortho/2' : 'ortho/1');
  return L === 0 ? null : 'topo/1';
}
async function ensureOverview(model) {
  if (!overview[model]) overview[model] = await loadHeights(`data/h/${model}/overview.png`);
  return overview[model];
}
async function loadChunk(c, L) {
  const key = `${state.model}|${L}|${state.base}`;
  let geo;
  if (L === 0) {
    const ov = await ensureOverview(state.model), r = LEVELS[0];
    geo = buildGeometry(ov, c.x0, c.z0, r, [c.x0 / r, c.z0 / r, c.w / r, c.h / r]);
  } else {
    const hg = await getHeights(`data/h/${state.model}/${L}/${c.cx}_${c.cy}.png`);
    geo = buildGeometry(hg, c.x0, c.z0, LEVELS[L]);
  }
  const tl = texLevel(L);
  const tex = tl ? await loadTex(`data/t/${tl}/${c.cx}_${c.cy}.jpg`) : null;
  return { geo, tex, key };
}
function applyChunk(c, L, r) {
  if (c.mesh) { terrain.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); }
  if (c.tex) c.tex.dispose();
  const mat = new THREE.ShaderMaterial({ uniforms: { ...U, baseTex: { value: r.tex || orthoOv }, useGlobal: { value: r.tex ? 0 : 1 } }, vertexShader: vert, fragmentShader: frag });
  c.mesh = new THREE.Mesh(r.geo, mat); c.mesh.frustumCulled = state.exag === 1; c.mesh.userData.chunk = c; c.tex = r.tex; c.shown = L; c.shownKey = r.key;
  terrain.add(c.mesh);
}
function wantedLevel(c, camPos) {
  const px = Math.max(c.x0, Math.min(camPos.x, c.x0 + c.w)), pz = Math.max(c.z0, Math.min(camPos.z, c.z0 + c.h));
  const gy = (groundAt(px, pz) - YOFF) * state.exag;
  const d = Math.hypot(camPos.x - px, (camPos.y - gy) * 0.8, camPos.z - pz);
  const k = state.mode === 'walk' ? 0.8 : 1;
  return d < 110 * k ? 4 : d < 280 * k ? 3 : d < 650 ? 2 : d < 1400 ? 1 : 0;
}
let inflight = 0; const MAXF = 6;
function updateChunks() {
  const cp = camera.position;
  const todo = [];
  for (const c of chunks) {
    c.want = wantedLevel(c, cp);
    const key = `${state.model}|${c.want}|${state.base}`;
    if (c.shownKey !== key && !c.busy) todo.push(c);
  }
  // nearest / most-needed first; level 0 first if nothing shown
  todo.sort((a, b) => (a.shown < 0 ? -1 : 0) - (b.shown < 0 ? -1 : 0) || (b.want - a.want));
  for (const c of todo) {
    if (c.want === 0 && c.shown <= 0) { const ov = overview[state.model]; if (ov) { const r = LEVELS[0];
      applyChunk(c, 0, { geo: buildGeometry(ov, c.x0, c.z0, r, [c.x0 / r, c.z0 / r, c.w / r, c.h / r]), tex: null, key: `${state.model}|0|${state.base}` }); continue; } }
    if (inflight >= MAXF) break;
    const L = c.want; c.busy = true; inflight++;
    loadChunk(c, L).then((r) => {
      if (r.key === `${state.model}|${c.want}|${state.base}` || c.shown < 0) applyChunk(c, L, r);
      else { r.geo.dispose(); r.tex?.dispose(); }
    }).catch((e) => console.warn(e)).finally(() => { c.busy = false; inflight--; });
  }
  const pending = chunks.filter((c) => c.shown < 0).length;
  status(pending ? `Loading terrain… ${Math.round(100 * (1 - pending / chunks.length))}%` : '');
}

// ---------- sampling helpers ----------
function bilinear(g, fx, fy) {
  fx = Math.max(0, Math.min(g.w - 1.001, fx)); fy = Math.max(0, Math.min(g.h - 1.001, fy));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, w = g.w;
  return (g.z[j * w + i] * (1 - u) + g.z[j * w + i + 1] * u) * (1 - v) + (g.z[(j + 1) * w + i] * (1 - u) + g.z[(j + 1) * w + i + 1] * u) * v;
}
const groundAt = (x, z) => bilinear(ground2, x / 2, z / 2);
const surfaceAt = (x, z) => (overview.dsm ? bilinear(overview.dsm, x / 8, z / 8) : groundAt(x, z));

// ---------- controls ----------
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 15; controls.maxDistance = 6000; controls.screenSpacePanning = false;
camera.position.set(1700, 1350, 2600); controls.target.set(1150, (groundAt(1150, 950) - YOFF), 950); controls.update();

// walk mode
const walk = { yaw: 0, pitch: -0.05, mv: { x: 0, y: 0 }, keys: {}, speed: 1.6 };
function enterWalk(x, z) {
  state.mode = 'walk'; controls.enabled = false;
  if (state.model !== 'dtm') setModel('dtm');
  const t = controls.target; x = x ?? t.x; z = z ?? t.z;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  walk.yaw = Math.atan2(-dir.x, -dir.z); walk.pitch = -0.05;
  camera.position.set(x, (groundAt(x, z) - YOFF) * state.exag + 1.7, z);
  $('#walkhint').style.display = 'block'; setTimeout(() => ($('#walkhint').style.display = 'none'), 4000);
  setOn('#g-mode', 'walk');
}
function exitWalk() {
  state.mode = 'orbit'; controls.enabled = true;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const p = camera.position.clone(); const t = p.clone().addScaledVector(dir, 60);
  camera.position.set(p.x - dir.x * 120, p.y + 80, p.z - dir.z * 120);
  controls.target.copy(t); controls.update(); setOn('#g-mode', 'orbit');
}
const el = renderer.domElement;
const touches = new Map(); let stickId = null, stickO = null, lookId = null, lookLast = null;
el.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'walk') return;
  if (e.clientX < innerWidth / 2 && stickId === null) {
    stickId = e.pointerId; stickO = { x: e.clientX, y: e.clientY };
    const s = $('#stick'); s.style.display = 'block'; s.style.left = e.clientX - 55 + 'px'; s.style.top = e.clientY - 55 + 'px';
  } else if (lookId === null) { lookId = e.pointerId; lookLast = { x: e.clientX, y: e.clientY }; }
});
addEventListener('pointermove', (e) => {
  if (state.mode !== 'walk') return;
  if (e.pointerId === stickId) {
    let dx = (e.clientX - stickO.x) / 50, dy = (e.clientY - stickO.y) / 50; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    walk.mv.x = dx; walk.mv.y = -dy; $('#stick i').style.transform = `translate(${dx * 33}px,${dy * 33}px)`;
  } else if (e.pointerId === lookId) {
    walk.yaw -= (e.clientX - lookLast.x) * 0.005; walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - (e.clientY - lookLast.y) * 0.005));
    lookLast = { x: e.clientX, y: e.clientY };
  }
});
const endPtr = (e) => {
  if (e.pointerId === stickId) { stickId = null; walk.mv.x = walk.mv.y = 0; $('#stick').style.display = 'none'; $('#stick i').style.transform = ''; }
  if (e.pointerId === lookId) lookId = null;
};
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
addEventListener('keydown', (e) => { walk.keys[e.key.toLowerCase()] = true; });
addEventListener('keyup', (e) => { walk.keys[e.key.toLowerCase()] = false; });

function stepWalk(dt) {
  const k = walk.keys; let f = walk.mv.y, s = walk.mv.x;
  if (k.w || k.arrowup) f += 1; if (k.s || k.arrowdown) f -= 1; if (k.a) s -= 1; if (k.d) s += 1;
  if (k.arrowleft) walk.yaw += dt * 1.5; if (k.arrowright) walk.yaw -= dt * 1.5;
  const sp = walk.speed * (k.shift ? 4 : 1);
  const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
  let x = camera.position.x + (-sy * f + cy * s) * sp * dt, z = camera.position.z + (-cy * f - sy * s) * sp * dt;
  x = Math.max(1, Math.min(W - 1, x)); z = Math.max(1, Math.min(H - 1, z));
  const y = (groundAt(x, z) - YOFF) * state.exag + 1.7;
  camera.position.set(x, camera.position.y + (y - camera.position.y) * Math.min(1, dt * 10), z);
  camera.rotation.set(0, 0, 0); camera.rotateY(walk.yaw); camera.rotateX(walk.pitch);
}

// ---------- tap info + catchment ----------
const ray = new THREE.Raycaster(); let downAt = null;
el.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
el.addEventListener('pointerup', (e) => {
  if (!downAt || state.mode === 'walk') return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8 || performance.now() - downAt.t > 400) return;
  const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(m, camera); terrain.scale.y = 1;
  const hits = ray.intersectObjects(terrain.children, false);
  // geometry is unscaled; shader scales y by exag, so intersect against a scaled copy of the ray
  let hit = null;
  if (state.exag === 1) hit = hits[0]?.point;
  else {
    const o = ray.ray.origin.clone(), d = ray.ray.direction.clone();
    for (let t = 0; t < 8000; t += 2) { const p = o.clone().addScaledVector(d, t); if (p.x < 0 || p.z < 0 || p.x > W || p.z > H) continue; if (p.y <= (surfaceAt(p.x, p.z) - YOFF) * state.exag) { hit = p; break; } }
  }
  if (hit) showInfo(hit.x, hit.z);
});
const fmt = (n, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
function areaStr(m2) { return m2 >= 10000 ? `${fmt(m2 / 10000, m2 >= 100000 ? 0 : 1)} ha` : `${fmt(m2)} m²`; }
let lastPick = null;
function showInfo(x, z) {
  lastPick = { x, z };
  const E = meta.E0 + x, N = meta.N1 - z, g = groundAt(x, z);
  const sl = (() => { const e = 2, a = groundAt(x + e, z) - groundAt(x - e, z), b = groundAt(x, z + e) - groundAt(x, z - e); return Math.atan(Math.hypot(a, b) / (2 * e)) * 180 / Math.PI; })();
  const ci = Math.min(2999, Math.max(0, Math.round(x))), cj = Math.min(1999, Math.max(0, Math.round(z)));
  const up = Math.pow(10, accG.a[cj * 3000 + ci] / 40);
  let html = `<h3>Point</h3>
    <div class="row">Ground level <b>${fmt(g, 1)} m</b></div>
    ${overview.dsm && state.model === 'dsm' ? `<div class="row">Tree / roof height <b>${fmt(Math.max(0, surfaceAt(x, z) - g), 1)} m</b></div>` : ''}
    <div class="row">Slope <b>${fmt(sl)}° (${fmt(Math.tan(sl * Math.PI / 180) * 100)}%)</b></div>
    <div class="row">Area draining here <b>${areaStr(up)}</b></div>
    <div class="row">UTM 31N (ETRS89) <b>${fmt(E)} E, ${fmt(N)} N</b></div>
    <div class="acts"><button id="b-catch">Show catchment</button><button id="b-walk">Walk from here</button></div>`;
  $('#pbody').innerHTML = html; $('#panel').classList.add('show');
  $('#b-catch').onclick = () => catchment(x, z);
  $('#b-walk').onclick = () => { $('#panel').classList.remove('show'); enterWalk(x, z); };
}
$('#pclose').onclick = () => { $('#panel').classList.remove('show'); U.showCatch.value = 0; };
const OFF = [null, [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // code -> (dx,dy)
function catchment(x, z) {
  const w = 3000, h = 2000, A = accG.a, F = fdirG.a;
  // snap to the strongest flow line within 6 m
  let bi = Math.round(x), bj = Math.round(z), bv = -1;
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
    const i = Math.round(x) + di, j = Math.round(z) + dj; if (i < 0 || j < 0 || i >= w || j >= h || di * di + dj * dj > 36) continue;
    if (A[j * w + i] > bv) { bv = A[j * w + i]; bi = i; bj = j; }
  }
  const mark = new Uint8Array(w * h); const q = new Int32Array(w * h); let qh = 0, qt = 0, edge = false;
  mark[bj * w + bi] = 1; q[qt++] = bj * w + bi;
  while (qh < qt) {
    const c = q[qh++], ci = c % w, cj = (c / w) | 0;
    if (ci === 0 || cj === 0 || ci === w - 1 || cj === h - 1) edge = true;
    for (let k = 1; k <= 8; k++) {
      const ni = ci - OFF[k][0], nj = cj - OFF[k][1]; if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const n = nj * w + ni; if (!mark[n] && Math.round(F[n] / 30) === k) { mark[n] = 1; q[qt++] = n; }
    }
  }
  const ctx = catchCanvas.getContext('2d'); const img = ctx.createImageData(1500, 1000);
  for (let j = 0; j < 1000; j++) for (let i = 0; i < 1500; i++) {
    const s = mark[(2 * j) * w + 2 * i] | mark[(2 * j) * w + 2 * i + 1] | mark[(2 * j + 1) * w + 2 * i] | mark[(2 * j + 1) * w + 2 * i + 1];
    img.data[(j * 1500 + i) * 4 + 3] = s ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0); catchTex.needsUpdate = true; U.showCatch.value = 1;
  const extra = $('#pbody').querySelector('.catch') || Object.assign(document.createElement('div'), { className: 'row catch' });
  extra.innerHTML = `Catchment above this point <b>${areaStr(qt)}${edge ? ' (runs off the model edge, so larger)' : ''}</b>`;
  $('#pbody').insertBefore(extra, $('#pbody .acts'));
}

// ---------- UI ----------
function setOn(grp, v) { document.querySelectorAll(`${grp} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
function setModel(m) {
  state.model = m; setOn('#g-model', m);
  if (m === 'dsm') ensureOverview('dsm');
  U.hRange.value.set(...meta[`${m}_range`]);
}
document.querySelectorAll('#g-base button').forEach((b) => b.onclick = () => {
  state.base = b.dataset.v; setOn('#g-base', state.base);
  U.mode.value = { photo: 0, map: 1, relief: 2 }[state.base];
  U.globalBase.value = state.base === 'map' ? topoOv : orthoOv;
});
document.querySelectorAll('#g-model button').forEach((b) => b.onclick = () => {
  if (b.dataset.v === 'dsm' && state.mode === 'walk') exitWalk();
  setModel(b.dataset.v);
});
document.querySelectorAll('#g-ovl button').forEach((b) => b.onclick = () => {
  const on = !b.classList.contains('on'); b.classList.toggle('on', on);
  if (b.dataset.v === 'drain') U.showDrain.value = on ? 1 : 0; else U.showSlope.value = on ? 1 : 0;
  legend();
});
document.querySelectorAll('#g-mode button').forEach((b) => b.onclick = () => (b.dataset.v === 'walk' ? (state.mode !== 'walk' && enterWalk()) : (state.mode === 'walk' && exitWalk())));
$('#exag').onclick = () => {
  state.exag = state.exag === 1 ? 1.5 : state.exag === 1.5 ? 2 : 1; U.exag.value = state.exag; $('#exag').textContent = state.exag + '×';
  for (const c of chunks) if (c.mesh) c.mesh.frustumCulled = state.exag === 1;
};
$('#compass').onclick = () => {
  if (state.mode === 'walk') { walk.yaw = 0; return; }
  const t = controls.target, d = camera.position.distanceTo(t), el2 = Math.asin((camera.position.y - t.y) / d);
  camera.position.set(t.x, t.y + d * Math.sin(el2), t.z + d * Math.cos(el2)); controls.update();
};
function legend() {
  const L = $('#legend'); const d = U.showDrain.value, s = U.showSlope.value;
  if (!d && !s) { L.style.display = 'none'; return; }
  let h = '';
  if (s) h += `<div><span class="sw" style="background:#33b34d"></span>&lt;5° <span class="sw" style="background:#f2e633"></span>5-15° <span class="sw" style="background:#ff8c1a"></span>15-30° <span class="sw" style="background:#d91a1a"></span>&gt;30°</div>`;
  if (d) h += `<div style="margin-top:4px">Show flow lines draining more than <b id="thrv"></b><br><input id="thr" type="range" min="2.3" max="5.5" step="0.1" value="${U.drainThr.value}"></div>`;
  L.innerHTML = h; L.style.display = 'block';
  const r = $('#thr'); if (r) { const upd = () => { U.drainThr.value = +r.value; $('#thrv').textContent = areaStr(Math.pow(10, +r.value)); }; r.oninput = upd; upd(); }
}

// ---------- loop ----------
const clock = new THREE.Clock(); let acc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, clock.getDelta());
  if (state.mode === 'walk') stepWalk(dt);
  else {
    controls.update();
    const gy = (Math.max(groundAt(Math.max(0, Math.min(W, camera.position.x)), Math.max(0, Math.min(H, camera.position.z))), 0) - YOFF) * state.exag;
    if (camera.position.y < gy + 8) camera.position.y = gy + 8;
  }
  acc += dt; if (acc > 0.25) { acc = 0; updateChunks(); }
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  $('#compass span').style.transform = `rotate(${Math.atan2(dir.x, -dir.z) * -180 / Math.PI}deg)`;
  renderer.render(scene, camera);
});
updateChunks();
