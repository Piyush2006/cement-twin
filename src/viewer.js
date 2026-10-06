/**
 * Three.js stage for the plant twin.
 *
 * The GLB arrives as ~10 merged draw calls with the named equipment still
 * separate, so selection can highlight real geometry while the bulk structure
 * stays cheap. Hotspots are DOM pins projected from world anchors measured by
 * tools/prepare-model.mjs — not hand-placed coordinates.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Surfaces are keyed off the EXPORT'S OWN material names, which survived where
 * node names did not. The material called `Red` is mis-named — its base colour
 * is RGB(17,23,142), i.e. the model author's blue, and it carries the pipework,
 * silo banding and trim. That makes the blue-on-white studio look the model's
 * own scheme rather than something painted over it.
 */
/**
 * Blue-on-white, mapped from what each source material actually covers in this
 * export (verified by rendering each one in isolation):
 *
 *   Red      tanks, pipework, kiln shell, silo banding, roofs   -> the hero blue
 *   Material.001  the alternating silo band                     -> white
 *   Material.002  silo cones and caps                           -> pale grey
 *   wire_*   buildings, conveyors, site detail                  -> white
 *   Material platforms, pads, preheater structure               -> cool off-white
 *
 * `Red` is mis-named — its base colour is RGB(17,23,142), the model author's
 * blue — so the scheme is the model's own, not something painted over it.
 */
/**
 * The non-blue surfaces are deliberately light GREY, not white. Painted white
 * on a white sweep they differ from the backdrop by a percent or two and the
 * structures disappear; separating them tonally is what makes the plant legible.
 * Value order, lightest to darkest: backdrop > floor > silo > structure > pad.
 */
const SURFACES = {
  blue: { color: 0x5367d8, roughness: 0.44, metalness: 0.08 },
  white: { color: 0xeaeff6, roughness: 0.62, metalness: 0.02 },
  shell: { color: 0xdfe6f0, roughness: 0.66, metalness: 0.03 },
  pad: { color: 0xc8d2e0, roughness: 0.78, metalness: 0.02 },
  cap: { color: 0xbfc9d9, roughness: 0.56, metalness: 0.06 },
  accent: { color: 0xdca01d, roughness: 0.5, metalness: 0.3 },
  terrain: { color: 0xdbe2ed, roughness: 1, metalness: 0 },
};

const BY_SOURCE_MATERIAL = [
  [/^red$/i, 'blue'],
  [/^material\.001$/i, 'white'],
  [/^material\.002$/i, 'cap'],
  [/^white$/i, 'white'],
  [/^wire_/i, 'shell'],
  [/^material$/i, 'pad'],
  [/navisworks/i, 'accent'],
];

const HIGHLIGHT = new THREE.Color(0x1655f2);

/**
 * Where the segment from (ax,ay) to the centre of a box leaves that box. Lets a
 * leader line stop at the pill's edge instead of disappearing under it.
 */
function edgeOfBox(ax, ay, cx, cy, halfW, halfH) {
  const dx = ax - cx;
  const dy = ay - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    halfW / Math.max(Math.abs(dx), 1e-6),
    halfH / Math.max(Math.abs(dy), 1e-6),
  );
  if (scale >= 1) return { x: ax, y: ay }; // anchor is inside the pill
  return { x: cx + dx * scale, y: cy + dy * scale };
}
const SKY = 0xf4f7fb;

export class PlantViewer {
  constructor(container, meta, areas = [], views = []) {
    this.container = container;
    this.meta = meta;
    this.assets = meta.assets;
    this.areas = areas;
    this.views = views;
    this.selected = null;
    this.listeners = new Set();
    this.assetMeshes = new Map(); // assetId -> Mesh[]
    this.pins = new Map();
    this.showHotspots = true;
    this._frames = 0;
    this._fpsAt = performance.now();
    this.fps = 0;

    const core = meta.core;
    this.coreBox = new THREE.Box3(
      new THREE.Vector3(...core.min),
      new THREE.Vector3(...core.max),
    );
    this.coreCenter = this.coreBox.getCenter(new THREE.Vector3());
    this.coreSize = this.coreBox.getSize(new THREE.Vector3());
    this.radius = Math.max(this.coreSize.x, this.coreSize.z) * 0.5;
    this.groundY = meta.groundY ?? core.min[1];
    this.lowestY = meta.lowestY ?? this.groundY;
    this.hull = meta.hull?.length
      ? meta.hull
      : (() => {
          const pts = [];
          for (let i = 0; i < 8; i++) {
            pts.push([i & 1 ? core.max[0] : core.min[0], i & 2 ? core.max[1] : core.min[1], i & 4 ? core.max[2] : core.min[2]]);
          }
          return pts;
        })();

    this.#initRenderer();
    this.#initScene();
    this.#initHotspotLayer();
    this.#bindEvents();
  }

  // ---------------------------------------------------------------- renderer
  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  #initScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(SKY);
    // Haze starts beyond the plant and ends inside the ground disc, so the disc
    // edge dissolves into the backdrop instead of drawing a hard horizon line.
    scene.fog = new THREE.Fog(SKY, this.radius * 6, this.radius * 14);

    this.camera = new THREE.PerspectiveCamera(42, 1, this.radius * 0.004, this.radius * 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = this.radius * 0.12;
    this.controls.maxDistance = this.radius * 9;
    this.controls.maxPolarAngle = Math.PI * 0.495; // never go under the ground
    this.controls.autoRotateSpeed = 0.45;
    this.controls.target.copy(this.coreCenter);

    // --- lighting: one hard sun for readable form, cool sky fill for depth
    // High-key studio set: a broad soft fill, one gentle key for form, and a
    // cool bounce — the look of a product render on a white sweep.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xccd6e8, 0.56);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfffdf8, 1.05);
    const d = this.radius;
    sun.position.set(this.coreCenter.x + d * 1.3, this.groundY + d * 2.3, this.coreCenter.z + d * 0.9);
    sun.target.position.copy(this.coreCenter);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = d * 0.4;
    sun.shadow.camera.far = d * 7;
    const s = d * 1.8;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = this.radius * 0.004;
    scene.add(sun, sun.target);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0xc9d8f0, 0.16);
    rim.position.set(this.coreCenter.x - d, this.groundY + d * 1.1, this.coreCenter.z - d * 1.4);
    scene.add(rim);

    // --- image-based lighting so the PBR surfaces are not flat
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.3;
    pmrem.dispose();

    this.#buildGround();

    this.raycaster = new THREE.Raycaster();
    this.modelRoot = new THREE.Group();
    scene.add(this.modelRoot);

    this.#initPost();
    this.#initHalo();
  }

  /**
   * Soft red marker for the equipment an open RCA refers to.
   *
   * The plant's bulk geometry is merged down to a handful of draw calls, so one
   * machine cannot simply be tinted — there is no separate mesh to tint. A halo
   * at the anchor marks the subject without pretending to isolate it.
   */
  #initHalo() {
    const g = new THREE.SphereGeometry(1, 28, 18);
    const m = new THREE.MeshBasicMaterial({
      color: 0xff3b30, transparent: true, opacity: 0.18,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(g, m);
    this.halo.visible = false;
    this.halo.renderOrder = 2;
    this.scene.add(this.halo);
  }

  /** @param {string|null} areaId area whose RCA is open, or null to clear */
  setAlertFocus(areaId) {
    const pin = areaId ? this.pins.get(areaId) : null;
    this.alertId = pin ? areaId : null;
    if (!pin) { this.halo.visible = false; return; }
    this.halo.position.copy(pin.anchor);
    this.halo.scale.setScalar(this.radius * 0.13);
    this.halo.visible = true;
  }

  /**
   * Ambient occlusion. On a white-on-white scene, lighting alone cannot separate
   * one pale surface from the pale surface behind it — the contact darkening is
   * what reads as form. Falls back to direct rendering if the pass won't build.
   */
  #initPost() {
    try {
      // `antialias: true` on the renderer only antialiases the default
      // framebuffer. Once we render into the composer's target that MSAA is
      // gone and every edge turns jagged, so the target needs its own samples.
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.renderer.getPixelRatio());
      composer.addPass(new RenderPass(this.scene, this.camera));

      const gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 1.0;
      gtao.updateGtaoMaterial({
        // world-space radius: the plant core is ~20 units across, so this is
        // roughly a half-metre of crevice at plant scale
        screenSpaceRadius: false,
        radius: this.radius * 0.085,
        distanceExponent: 1.1,
        thickness: this.radius * 0.1,
        scale: 1.35,
        samples: 8,
        distanceFallOff: 1,
      });
      // keep the denoise tight: a wide blur is what makes AO look smeary
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 2, rings: 2, samples: 8 });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());

      this.composer = composer;
      this.gtao = gtao;
    } catch (err) {
      console.warn('[twin] ambient occlusion unavailable, rendering direct:', err);
      this.composer = null;
    }
  }

  /** Turn AO off (it is the most expensive pass by far). */
  setAO(on) {
    if (this.gtao) this.gtao.enabled = on;
  }

  /**
   * A solid plinth, not an infinite plane. Without a visible base with visible
   * edges the plant reads as floating once you orbit it. Its top sits at site
   * grade and it is made deep enough to swallow the terrain mesh, which dips
   * well below the pads the plant actually stands on.
   */
  #buildGround() {
    const g = new THREE.Group();
    const half = this.radius * 1.55;
    const depth = Math.max(this.groundY - this.lowestY + this.radius * 0.06, this.radius * 0.05);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, depth, half * 2),
      [
        new THREE.MeshStandardMaterial({ color: 0xb9c5d6, roughness: 0.95, metalness: 0 }), // +x
        new THREE.MeshStandardMaterial({ color: 0xb9c5d6, roughness: 0.95, metalness: 0 }), // -x
        new THREE.MeshStandardMaterial({ color: 0xd3dceb, roughness: 1, metalness: 0 }),    // top
        new THREE.MeshStandardMaterial({ color: 0xa6b3c7, roughness: 0.95, metalness: 0 }), // bottom
        new THREE.MeshStandardMaterial({ color: 0xb9c5d6, roughness: 0.95, metalness: 0 }), // +z
        new THREE.MeshStandardMaterial({ color: 0xb9c5d6, roughness: 0.95, metalness: 0 }), // -z
      ],
    );
    slab.position.y = this.groundY - depth / 2;
    slab.receiveShadow = true;
    g.add(slab);
    this.slab = slab;

    const grid = new THREE.GridHelper(half * 2, 34, 0x9fb0c6, 0xc3cedd);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.position.y = this.groundY + this.radius * 0.0015;
    g.add(grid);
    this.grid = grid;

    this.scene.add(g);
    this.groundGroup = g;
  }

  #initHotspotLayer() {
    this.layer = document.createElement('div');
    this.layer.className = 'hotspots';
    this.container.appendChild(this.layer);

    // Leader lines: cards are large and get pushed off their anchors to avoid
    // overlapping, so without a connector the pairing stops being obvious.
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lines.setAttribute('class', 'hotspot-lines');
    this.layer.appendChild(this.lines);

    for (const a of this.areas) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', 'hotspot-line');
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      tip.setAttribute('class', 'hotspot-tip');
      tip.setAttribute('r', '3');
      line.dataset.band = 'none';
      tip.dataset.band = 'none';
      g.append(line, tip);
      this.lines.appendChild(g);

      const pin = document.createElement('button');
      pin.className = 'pin';
      pin.type = 'button';
      pin.dataset.band = 'none';
      pin.title = a.name;
      pin.innerHTML = `
        <span class="pin__badge">${a.no ?? '\u00b7'}</span>
        <span class="pin__name">${a.name}</span>
        <span class="pin__chev" aria-hidden="true">\u2304</span>`;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDetail(a.id);
      });
      this.layer.appendChild(pin);

      this.pins.set(a.id, { el: pin, line, tip, area: a, anchor: new THREE.Vector3(...a.anchor) });
    }

    // One reusable detail popover, shown under whichever pin is open.
    this.detail = document.createElement('div');
    this.detail.className = 'detail';
    this.detail.hidden = true;
    this.layer.appendChild(this.detail);
    this.detail.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.closeDetail();
    });
  }

  toggleDetail(areaId) {
    if (this.openId === areaId) { this.closeDetail(); return; }
    this.openId = areaId;
    this.detail.hidden = false;
    this.focusPoint(new THREE.Vector3(...this.pins.get(areaId).anchor));
    this.#renderDetail();
  }

  closeDetail() {
    this.openId = null;
    this.detail.hidden = true;
    for (const [, p] of this.pins) p.el.dataset.open = 'false';
  }

  /**
   * Live values for every annotation.
   * @param {(areaId:string)=>object|null} fn
   */
  setAreaData(fn) {
    this.areaData = fn;
    for (const [id, p] of this.pins) {
      const d = fn(id);
      const band = d?.healthBand ?? 'none';
      if (p.el.dataset.band !== band) {
        p.el.dataset.band = band;
        p.line.dataset.band = band;
        p.tip.dataset.band = band;
      }

    }
    if (this.openId) this.#renderDetail();
  }

  #renderDetail() {
    const id = this.openId;
    const pin = this.pins.get(id);
    if (!pin) return;
    const a = pin.area;
    const d = this.areaData?.(id) ?? {};
    for (const [pid, p] of this.pins) p.el.dataset.open = String(pid === id);

    const pct = (v, dec = 1) => (v == null ? '\u2014' : `${v.toFixed(dec)}%`);
    const band = (k, v) => (v == null ? 'none' : (this.metricBand?.[k]?.(v) ?? 'none'));

    // The twin surface stays free of figures; these three appear only once the
    // card is expanded. Everything beyond them belongs to BRUCE.
    const metrics = `
      <div class="detail__kpis">
        <span class="detail__kpi"><i>Production</i>${
          d.output == null ? '\u2014' : `${d.output.toFixed(0)} <u>/ ${d.rated} ${d.unit}</u>`}</span>
        <span class="detail__kpi" data-band="${d.healthBand ?? 'none'}"><i>Health</i>${
          d.health == null ? '\u2014' : `${d.health.toFixed(0)} <u>/100</u>`}</span>
        <span class="detail__kpi"><i>Energy</i>${
          d.sec == null ? '\u2014' : `${d.sec.toFixed(0)} <u>${d.secUnit}</u>`}</span>
      </div>
`;

    this.detail.innerHTML = `
      <button class="detail__head" type="button" data-act="close" data-band="${d.healthBand ?? 'none'}">
        <span class="detail__badge">${a.no ?? '\u00b7'}</span>
        <span class="detail__name">${a.name}</span>
        <span class="detail__chev" aria-hidden="true">\u2303</span>
      </button>
      <div class="detail__body">${metrics}</div>`;
  }

  /**
   * Drop every annotation anchor onto the geometry below it.
   *
   * Anchors are authored as a position on the site plan; picking their height by
   * hand leaves the marker dot hanging in the air above (or buried inside) the
   * equipment. Casting a ray straight down from above the site and taking the
   * first hit puts each dot exactly on the surface it names.
   *
   * Returns a report so a miss — an anchor over empty ground — is visible rather
   * than silently rendering in mid-air.
   */
  snapAnchorsToSurface() {
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = true;
    const down = new THREE.Vector3(0, -1, 0);
    const startY = this.coreBox.max.y + this.radius * 2;
    const cast = (x, z) => {
      ray.set(new THREE.Vector3(x, startY, z), down);
      return ray.intersectObject(this.modelRoot, true)[0];
    };

    const report = [];
    for (const [id, p] of this.pins) {
      let hit = cast(p.anchor.x, p.anchor.z);
      let moved = 0;
      // Authored coordinates can sit just off a structure. Rather than leave the
      // marker hanging, search outward for the nearest geometry and report how
      // far it had to go, so the source coordinate can be corrected.
      if (!hit) {
        const step = this.radius * 0.06;
        outer: for (let ring = 1; ring <= 8; ring++) {
          for (let a = 0; a < 12; a++) {
            const th = (a / 12) * Math.PI * 2;
            const dx = Math.cos(th) * step * ring;
            const dz = Math.sin(th) * step * ring;
            const h = cast(p.anchor.x + dx, p.anchor.z + dz);
            if (h) {
              hit = h;
              p.anchor.x += dx;
              p.anchor.z += dz;
              moved = step * ring;
              break outer;
            }
          }
        }
      }
      if (hit) p.anchor.y = hit.point.y;
      report.push({
        id,
        pos: [+p.anchor.x.toFixed(2), +p.anchor.y.toFixed(2), +p.anchor.z.toFixed(2)],
        snapped: !!hit,
        movedBy: +moved.toFixed(2),
      });
    }
    const missed = report.filter((r) => !r.snapped);
    if (missed.length) {
      console.warn('[twin] anchors with no geometry anywhere near them:',
        missed.map((m) => m.id).join(', '));
    }
    const nudged = report.filter((r) => r.movedBy > 0);
    if (nudged.length) {
      console.warn('[twin] anchors nudged onto nearby geometry — paste these back into data/areas.js:',
        nudged.map((r) => `${r.id} -> [${r.pos.join(', ')}]`).join('  |  '));
    }
    this.anchorReport = report;
    return report;
  }

  /** Fly to an arbitrary world point — areas have no bounding box of their own. */
  focusPoint(target) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.35;
    dir.normalize();
    // close enough to read the equipment, far enough to keep its surroundings
    this.#animateCamera(target.clone().add(dir.multiplyScalar(this.radius * 1.35)), target.clone());
  }

  #bindEvents() {
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    this.resize();

    // click-through on the model: pick the asset whose box is nearest the hit
    const el = this.renderer.domElement;
    let downAt = null;
    el.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return; // that was a drag, not a click
      const hits = this.raycaster.intersectObject(this.modelRoot, true);
      if (hits.length) {
        const p = hits[0].point;
        console.log(`[twin] clicked world position: [${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}]`
          + '  — paste into src/data/areas.js as an anchor');
      }
      const hit = this.#pick(e);
      this.select(hit, { fly: false });
    });
  }

  #pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.modelRoot, true);
    if (!hits.length) return null;

    const p = hits[0].point;
    // direct hit on a named asset wins
    for (const [id, meshes] of this.assetMeshes) {
      if (meshes.includes(hits[0].object)) return id;
    }
    // otherwise attribute the hit to an asset only if it lands inside its box
    let best = null;
    let bestD = Infinity;
    for (const a of this.assets) {
      const box = new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max));
      box.expandByScalar(this.radius * 0.03);
      if (!box.containsPoint(p)) continue;
      const d = box.getCenter(new THREE.Vector3()).distanceTo(p);
      if (d < bestD) { bestD = d; best = a.id; }
    }
    return best;
  }

  // -------------------------------------------------------------------- load
  async load(url, onProgress) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
      else if (onProgress) onProgress(null, e.loaded);
    });

    this.modelRoot.add(gltf.scene);
    this.triangles = 0;
    this.drawCalls = 0;

    const meshes = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes.push(o);
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = true;
      const geo = o.geometry;
      geo.computeBoundingBox();
      this.triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      this.drawCalls += 1;
    });

    // widest footprint is the terrain shell — give it earth, not plant steel
    let widest = null;
    let widestSpan = -1;
    for (const m of meshes) {
      const s = m.geometry.boundingBox.getSize(new THREE.Vector3());
      const span = Math.max(s.x, s.z);
      if (span > widestSpan) { widestSpan = span; widest = m; }
    }

    for (const m of meshes) {
      const src = m.material?.name ?? '';
      const key = m === widest && widestSpan > this.radius * 1.2
        ? 'terrain'
        : BY_SOURCE_MATERIAL.find(([re]) => re.test(src))?.[1] ?? 'shell';
      m.material = new THREE.MeshStandardMaterial({
        ...SURFACES[key],
        envMapIntensity: 0.4,
      });
      m.userData.baseColor = m.material.color.clone();
      m.userData.surface = key;
    }

    // bind geometry to assets: a named node if one matches, else by containment
    for (const a of this.assets) {
      const list = [];
      const box = new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max));
      box.expandByScalar(this.radius * 0.015);
      for (const m of meshes) {
        if (m === widest) continue;
        const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
        m.localToWorld(c);
        if (box.containsPoint(c)) list.push(m);
      }
      this.assetMeshes.set(a.id, list);
    }

    this.snapAnchorsToSurface();
    this.frame('overview');
    return { triangles: Math.round(this.triangles), drawCalls: this.drawCalls };
  }

  // ------------------------------------------------------------------ camera
  /** Position the camera from a preset in VIEWS, framing either the plant or one asset. */
  frame(presetOrView, views) {
    // Resolve names against the configured presets. Falling back to a hardcoded
    // view here silently ignores data/process.js, which is how the default
    // framing drifted away from its own config.
    const list = views ?? this.views ?? [];
    const view = typeof presetOrView === 'string'
      ? list.find((v) => v.id === presetOrView) ?? list[0] ?? { theta: 0.72, phi: 1.02, dist: 0.78 }
      : presetOrView;

    let target = this.coreCenter.clone();
    let pts = this.hull;
    if (view.focus) {
      const a = this.assets.find((x) => x.id === view.focus);
      if (a) {
        target = new THREE.Vector3(...a.center);
        pts = this.#assetPoints(a, 0.9);
      }
    }
    const phi = THREE.MathUtils.clamp(view.phi ?? 0.95, 0.06, Math.PI * 0.49);
    const theta = view.theta ?? 0.72;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ).normalize();
    // `dist` is a margin on an exact fit, so framing holds at any aspect ratio
    const dist = Math.max(this.#fitDistance(pts, target, dir) * (view.dist ?? 1.06), this.radius * 0.12);
    this.#animateCamera(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  /**
   * Smallest distance along `dir` at which every point of `pts` is still inside
   * the frustum. Fitting the real occupancy rather than a bounding box matters
   * here: the site is laid out diagonally, so the box corners are empty air.
   */
  #fitDistance(pts, target, dir) {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const tanV = Math.tan(vFov / 2);
    const tanH = Math.tan(vFov / 2) * this.camera.aspect;

    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();

    const v = new THREE.Vector3();
    let need = 0;
    for (const p of pts) {
      v.set(p[0], p[1], p[2]).sub(target);
      const z = v.dot(dir); // positive = toward the camera
      need = Math.max(need, z + Math.abs(v.dot(right)) / tanH, z + Math.abs(v.dot(up)) / tanV);
    }
    return need;
  }

  /** The 8 corners of an asset's measured box, as a point list. */
  #assetPoints(a, grow = 0) {
    const g = a.size.map((v) => v * grow);
    const lo = a.min.map((v, k) => v - g[k]);
    const hi = a.max.map((v, k) => v + g[k]);
    const pts = [];
    for (let i = 0; i < 8; i++) pts.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
    return pts;
  }

  /** Fly to an asset, keeping a sensible stand-off from its bounding box. */
  focusAsset(assetId) {
    const a = this.assets.find((x) => x.id === assetId);
    if (!a) return;
    const target = new THREE.Vector3(...a.center);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.35;
    dir.normalize();
    const dist = Math.max(this.#fitDistance(this.#assetPoints(a, 0.75), target, dir) * 1.1, this.radius * 0.1);
    this.#animateCamera(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  #animateCamera(toPos, toTarget, ms = 760) {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const t0 = performance.now();
    this._anim = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic, no overshoot
      this.camera.position.lerpVectors(fromPos, toPos, e);
      this.controls.target.lerpVectors(fromTarget, toTarget, e);
      if (k >= 1) this._anim = null;
    };
  }

  // --------------------------------------------------------------- selection
  select(assetId, { fly = false } = {}) {
    if (assetId === this.selected && !fly) return;
    this.selected = assetId;
    this.#applyHighlight();
    if (fly && assetId) this.focusAsset(assetId);
    for (const cb of this.listeners) cb(assetId);
  }

  #applyHighlight() {
    for (const [id, meshes] of this.assetMeshes) {
      const on = id === this.selected;
      for (const m of meshes) {
        if (!m.userData.baseColor) continue;
        if (on) {
          m.material.color.copy(m.userData.baseColor).lerp(HIGHLIGHT, 0.62);
          m.material.emissive = HIGHLIGHT;
          m.material.emissiveIntensity = 0.22;
        } else {
          m.material.color.copy(m.userData.baseColor);
          m.material.emissiveIntensity = 0;
        }
      }
    }
  }

  onSelect(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  // ------------------------------------------------------------------ toggles
  setHotspots(on) {
    this.showHotspots = on;
    this.layer.style.display = on ? '' : 'none';
  }
  setGrid(on) { if (this.grid) this.grid.visible = on; }
  setAutoRotate(on) { this.controls.autoRotate = on; }
  /** Shadows are the expensive part; off makes software-GL verification viable. */
  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.modelRoot.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
  }
  setWireframe(on) {
    this.modelRoot.traverse((o) => { if (o.isMesh) o.material.wireframe = on; });
  }

  // -------------------------------------------------------------------- loop
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.composer?.setSize(w, h);
    this.gtao?.setSize(w * dpr, h * dpr);
  }

  render(now) {
    if (this._anim) this._anim(now);
    this.controls.update();
    if (this.halo?.visible) {
      // slow pulse, so the marked equipment reads as live rather than painted on
      this.halo.material.opacity = 0.13 + Math.sin(now * 0.0025) * 0.06;
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (this.showHotspots) this.#projectPins();

    this._frames += 1;
    if (now - this._fpsAt >= 500) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsAt));
      this._frames = 0;
      this._fpsAt = now;
    }
  }

  #projectPins() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const v = new THREE.Vector3();
    const placed = [];

    // Resolve collisions in a FIXED order (the order areas are declared), never
    // by camera distance. Distance order re-sorts as you orbit, so two labels
    // swap which of them gets displaced and both appear to jump.
    for (const [id, p] of this.pins) {
      v.copy(p.anchor).project(this.camera);
      // Only drop a label when its subject is behind the camera or far outside
      // the frustum. Anything merely clipped by the edge gets clamped into view
      // below, with its leader still running out toward the equipment — zooming
      // in should not silently lose annotations.
      if (v.z > 1 || v.z < -1 || v.x < -2.6 || v.x > 2.6 || v.y < -2.6 || v.y > 2.6) {
        p.el.style.opacity = '0';
        p.el.style.pointerEvents = 'none';
        p.line.setAttribute('d', '');
        p.tip.setAttribute('r', '0');
        continue;
      }
      const ax = ((v.x + 1) / 2) * w;
      const ay = ((1 - v.y) / 2) * h;
      const halfW = (p.el.offsetWidth || 158) / 2;
      const halfH = (p.el.offsetHeight || 46) / 2;
      // Sit the pill a fixed distance ABOVE its point rather than on top of it:
      // a label covering the thing it names cannot show what it is pointing at,
      // and it guarantees every pill has a visible leader.
      const LIFT = halfH + 32;
      const x = Math.min(Math.max(ax, halfW + 8), w - halfW - 8);
      let y = Math.min(Math.max(ay - LIFT, halfH + 8), h - halfH - 8);
      // Stack clashes downward, but flip upward when there is no room left —
      // otherwise cards near the bottom edge all get clamped back onto each
      // other and end up perfectly superimposed.
      const loY = halfH + 8;
      const hiY = h - halfH - 8;
      for (let guard = 0; guard < 16; guard++) {
        const clash = placed.find(
          (q) => Math.abs(q.x - x) < q.halfW + halfW - 6 && Math.abs(q.y - y) < (q.halfH + halfH) + 5,
        );
        if (!clash) break;
        const gap = (clash.halfH + halfH) + 7;
        const down = clash.y + gap;
        const up = clash.y - gap;
        if (down <= hiY) y = down;
        else if (up >= loY) y = up;
        else { y = Math.max(loY, Math.min(hiY, up)); break; }
      }
      y = Math.max(loY, Math.min(y, hiY));
      // whole pixels only — sub-pixel values make the text shimmer as you orbit
      const px = Math.round(x);
      const py = Math.round(y);
      placed.push({ x: px, y: py, halfW, halfH });
      p.el.style.opacity = '1';
      p.el.style.pointerEvents = 'auto';
      p.el.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;

      // A leader always runs from the marked point to the edge of its pill, so
      // which label belongs to which equipment never has to be guessed.
      if (id === this.openId && !this.detail.hidden) {
        const dw = this.detail.offsetWidth || 250;
        const dh = this.detail.offsetHeight || 220;
        const dx = Math.min(Math.max(px, dw / 2 + 8), w - dw / 2 - 8);
        const dy = Math.min(py + halfH + 6, h - dh - 8);
        this.detail.style.transform = `translate3d(${Math.round(dx - dw / 2)}px, ${Math.round(dy)}px, 0)`;
      }
      p.tip.setAttribute('r', '3');
      p.tip.setAttribute('cx', ax.toFixed(1));
      p.tip.setAttribute('cy', ay.toFixed(1));
      const edge = edgeOfBox(ax, ay, px, py, halfW + 2, halfH + 2);
      const run = Math.hypot(edge.x - ax, edge.y - ay);
      // Quadratic leader: leaves the marked point vertically, then bends into the
      // card. Reads as a drawn callout rather than a bare connecting line.
      const d = run > 4
        ? `M${ax.toFixed(1)},${ay.toFixed(1)} Q${ax.toFixed(1)},${edge.y.toFixed(1)} ${edge.x.toFixed(1)},${edge.y.toFixed(1)}`
        : '';
      p.line.setAttribute('d', d);
    }
  }

  dispose() {
    removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
