/**
 * Turns the salvaged GLB into the runtime asset for the twin.
 *
 *   1. keeps a single scene — the four "scenes" are near-duplicate plant variants
 *   2. drops spatial outliers (this export has one degenerate CAD solid 1e6 units out)
 *   3. measures world-space bounds of the named equipment -> hotspot anchors,
 *      clustering the repeated silos into spatially coherent groups
 *   4. recenters on the equipment cluster, then
 *      dedup -> flatten -> join -> weld -> prune -> meshopt
 *
 * Anchors are measured BEFORE the merge, while per-object identity still exists.
 * Re-run this verbatim against a complete download; it adapts to whatever arrives.
 */
import { NodeIO, Logger, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

const SRC = process.argv[2] ?? resolve('build/plant-salvaged.glb');
const OUT_GLB = process.argv[3] ?? resolve('public/models/plant.glb');
const OUT_META = process.argv[4] ?? resolve('src/data/plant-geometry.json');
const SCENE = process.env.PLANT_SCENE ?? 'Process';

/** Bulk CAD output carries no semantic meaning — safe to merge into one draw call. */
const ANONYMOUS = [
  /^3D Solid/i, /^Subentity/i, /^Polygon Mesh/i, /^Region/i, /^Plane/i, /^Cube/i,
  /^Cylinder/i, /^Empty/i, /^body ?\d/i, /^rock_/i, /^Rock_/i, /^Mesh/i, /^Line/i,
  /^Solid/i, /^hammer/i, /^battery/i, /^3d-model/i, /_curve_/i,
];

/** Equipment classes we keep individually addressable. Order matters — first match wins. */
const CLASSES = [
  { kind: 'preheater', match: /preheater|calciner/i, label: 'Preheater & Calciner', group: 'single' },
  { kind: 'clinker-silo', match: /^clinker/i, label: 'Clinker Silo', group: 'single' },
  { kind: 'cement-silo', match: /^silo\b/i, label: 'Cement Silo', group: 'cluster' },
  { kind: 'silo-shade', match: /^silos shade/i, label: 'Silo Canopy', group: 'skip' },
  { kind: 'pressure-tank', match: /pressure tank/i, label: 'Pressure Tank', group: 'single' },
];

const clean = (n = '') =>
  n.replace(/^BL\|/, '').split('$0$')[0].replace(/\.\d{3,}$/, '')
   .replace(/_curve_.*$/, '').replace(/_mesh_.*$/, '').trim();

const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;
const centerOf = (b) => [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
const sizeOf = (b) => [0, 1, 2].map((k) => b.max[k] - b.min[k]);
const median = (a) => {
  const v = a.slice().sort((x, y) => x - y);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder })
  .setLogger(new Logger(Logger.Verbosity.WARN));

const srcBytes = statSync(SRC).size;
console.log(`reading     : ${SRC} (${(srcBytes / 1e6).toFixed(1)} MB)`);
const doc = await io.read(SRC);
const root = doc.getRoot();

// ---- 1. keep one scene -----------------------------------------------------
const scenes = root.listScenes();
const scenesAvailable = scenes.map((s) => ({ name: s.getName(), nodes: s.listChildren().length }));
const target =
  scenes.find((s) => s.getName() === SCENE && s.listChildren().length > 0) ??
  scenes.reduce((a, b) => (b.listChildren().length > a.listChildren().length ? b : a));
console.log(`scene       : "${target.getName()}" of [${scenesAvailable.map((s) => `${s.name}:${s.nodes}`).join(', ')}]`);
root.setDefaultScene(target);
for (const s of scenes) if (s !== target) s.dispose();
await doc.transform(prune({ keepLeaves: false }));

const meshesBefore = root.listMeshes().length;
const nodesBefore = root.listNodes().length;

// ---- 2. inventory every mesh node, with world bounds -----------------------
function* walk(node) {
  for (const c of node.listChildren()) {
    yield c;
    yield* walk(c);
  }
}
const boxOf = (list) => ({
  min: [0, 1, 2].map((k) => Math.min(...list.map((i) => i.bounds.min[k]))),
  max: [0, 1, 2].map((k) => Math.max(...list.map((i) => i.bounds.max[k]))),
});

const items = [];
for (const node of target.listChildren().flatMap((n) => [n, ...walk(n)])) {
  if (!node.getMesh()) continue;
  const b = getBounds(node);
  if (!b || b.min.some((v) => !Number.isFinite(v)) || b.max.some((v) => !Number.isFinite(v))) continue;
  items.push({ node, name: clean(node.getName()), bounds: b, center: centerOf(b), size: sizeOf(b) });
}

// ---- 3. drop spatial / scale outliers --------------------------------------
// CAD exports routinely carry strays: a solid parked millions of units from the
// site (wrecks depth precision and camera framing) and a single huge backdrop
// plane (encloses the scene, and with its texture lost it is just grey sludge).
const horiz = (i) => Math.max(i.size[0], i.size[2]);
const med = [0, 1, 2].map((k) => median(items.map((i) => i.center[k])));
const distOf = (i) => Math.hypot(...i.center.map((v, k) => v - med[k]));
const pct = (arr, p) => {
  const v = arr.slice().sort((a, b) => a - b);
  return v[Math.floor(p * (v.length - 1))];
};
const DIST_CUT = Math.max(pct(items.map(distOf), 0.95) * 12, 500);
const SIZE_CUT = Math.max(median(items.map((i) => Math.max(...i.size))) * 2000, 2000);

const dropped = [];
let survivors = items.filter((i) => {
  const why = distOf(i) > DIST_CUT ? 'far from site'
            : Math.max(...i.size) > SIZE_CUT ? 'degenerate scale'
            : null;
  if (why) dropped.push({ item: i, why });
  return !why;
});

// Second pass: measure the plant from ordinary-sized objects, then discard
// anything whose footprint dwarfs the whole site — that is scenery, not plant.
const footCut = pct(survivors.map(horiz), 0.99) * 1.5;
const plantish = survivors.filter((i) => horiz(i) <= footCut);
const probe = boxOf(plantish.length ? plantish : survivors);
const siteDiag = Math.hypot(probe.max[0] - probe.min[0], probe.max[2] - probe.min[2]);
survivors = survivors.filter((i) => {
  if (horiz(i) > siteDiag * 1.5) {
    dropped.push({ item: i, why: 'backdrop / scenery' });
    return false;
  }
  return true;
});

for (const { item, why } of dropped) {
  console.log(`  outlier   : "${item.name}" at ${item.center.map((v) => Math.round(v)).join(',')} `
            + `size ${item.size.map((v) => Math.round(v)).join('x')} — ${why}`);
  item.node.dispose();
}
const kept = survivors;
console.log(`outliers    : ${dropped.length} removed, ${kept.length} mesh nodes kept`);

// ---- 4. hotspot anchors ----------------------------------------------------
// "core" = the plant proper, measured from ordinary-sized objects. Terrain
// sprawls much wider and would otherwise frame the plant as a dot on a plain.
const coreMembers = kept.filter((i) => horiz(i) <= pct(kept.map(horiz), 0.99) * 1.5);
const coreBox = boxOf(coreMembers.length ? coreMembers : kept);
const fullBox = boxOf(kept);
const origin = centerOf(coreBox); // everything below is re-expressed relative to this

/** Single-linkage clustering so repeated silos become one addressable group. */
function cluster(list, radius) {
  // Plant layout is a ground-plan problem, so cluster on the horizontal plane
  // only — otherwise a tall silo and the hopper beneath it become one asset.
  const gap = (a, b) => Math.hypot(a.center[0] - b.center[0], a.center[2] - b.center[2]);
  const out = list.map((it) => ({ members: [it] }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < out.length && !merged; a++) {
      for (let b = a + 1; b < out.length && !merged; b++) {
        if (out[a].members.some((m) => out[b].members.some((n) => gap(m, n) <= radius))) {
          out[a].members.push(...out[b].members);
          out.splice(b, 1);
          merged = true;
        }
      }
    }
  }
  return out;
}

/**
 * A decimated point cloud of the plant's real occupancy. Framing against the
 * core *box* wastes most of the frame, because the site is laid out
 * diagonally and the box corners are empty air. Fitting against these points
 * follows the actual shape.
 */
function hullCloud(list, cell) {
  const seen = new Set();
  const pts = [];
  for (const i of list) {
    for (let k = 0; k < 8; k++) {
      const p = [
        k & 1 ? i.bounds.max[0] : i.bounds.min[0],
        k & 2 ? i.bounds.max[1] : i.bounds.min[1],
        k & 4 ? i.bounds.max[2] : i.bounds.min[2],
      ];
      const key = p.map((v) => Math.round(v / cell)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(p);
    }
  }
  return pts;
}

const assets = [];
const relBox = (b) => ({
  min: b.min.map((v, k) => round(v - origin[k])),
  max: b.max.map((v, k) => round(v - origin[k])),
});
function pushAsset({ id, kind, label, list }) {
  const b = boxOf(list);
  const rb = relBox(b);
  const c = [0, 1, 2].map((k) => round((rb.min[k] + rb.max[k]) / 2));
  assets.push({
    id, kind, label,
    parts: list.length,
    sourceNames: [...new Set(list.map((i) => i.name))].sort(),
    min: rb.min,
    max: rb.max,
    center: c,
    size: [0, 1, 2].map((k) => round(rb.max[k] - rb.min[k])),
    // marker floats a little above the asset so it never sinks into geometry
    anchor: [c[0], round(rb.max[1] + Math.max((rb.max[1] - rb.min[1]) * 0.12, 0.35)), c[2]],
  });
}

for (const spec of CLASSES) {
  if (spec.group === 'skip') continue;
  const list = kept.filter((i) => spec.match.test(i.name) && CLASSES.find((c) => c.match.test(i.name)) === spec);
  if (!list.length) continue;
  if (spec.group === 'cluster') {
    const radius = Math.max(pct(list.map(horiz), 0.9) * 1.8, 0.4);
    const groups = cluster(list, radius).sort((a, b) => boxOf(a.members).min[0] - boxOf(b.members).min[0]);
    groups.forEach((g, n) => pushAsset({
      id: `${spec.kind}-${n + 1}`,
      kind: spec.kind,
      label: g.members.length > 1 ? `${spec.label} Group ${n + 1}` : `${spec.label} ${n + 1}`,
      list: g.members,
    }));
    console.log(`  ${spec.kind.padEnd(13)}: ${list.length} parts -> ${groups.length} groups (radius ${radius.toFixed(2)})`);
  } else {
    pushAsset({ id: spec.kind, kind: spec.kind, label: spec.label, list });
    console.log(`  ${spec.kind.padEnd(13)}: ${list.length} parts -> 1 asset`);
  }
}

// ---- 5. anonymise bulk solids so `join` can merge them ---------------------
let anonymised = 0;
for (const node of root.listNodes()) {
  const name = node.getName();
  if (!name) continue;
  const base = clean(name);
  if (CLASSES.some((c) => c.group !== 'skip' && c.match.test(base))) continue;
  if (ANONYMOUS.some((re) => re.test(base))) {
    node.setName('');
    node.getMesh()?.setName('');
    anonymised += 1;
  }
}
console.log(`anonymised  : ${anonymised} bulk CAD nodes (mergeable)`);

// ---- 6. recenter on the equipment cluster ----------------------------------
for (const node of target.listChildren()) {
  const t = node.getTranslation();
  node.setTranslation([t[0] - origin[0], t[1] - origin[1], t[2] - origin[2]]);
}

// ---- 7. optimise -----------------------------------------------------------
console.log('optimising  : dedup -> flatten -> join -> weld -> prune -> meshopt');
await doc.transform(
  dedup(),
  flatten(),
  join({ keepNamed: true, cleanup: true }),
  weld(),
  prune({ keepLeaves: false, keepAttributes: false }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

// ---- 8. write --------------------------------------------------------------
mkdirSync(dirname(OUT_GLB), { recursive: true });
mkdirSync(dirname(OUT_META), { recursive: true });
const glb = await io.writeBinary(doc);
writeFileSync(OUT_GLB, glb);

const cell = Math.max(...sizeOf(coreBox)) / 26;
const hull = hullCloud(coreMembers.length ? coreMembers : kept, cell)
  .map((p) => p.map((v, k) => round(v - origin[k], 2)));

const meta = {
  generatedAt: new Date().toISOString(),
  source: {
    file: basename(SRC),
    bytes: srcBytes,
    scene: target.getName(),
    scenesAvailable,
  },
  // all coordinates below are relative to the recentred model origin
  core: relBox(coreBox),
  extent: relBox(fullBox),
  coreSize: sizeOf(coreBox).map((v) => round(v)),
  extentSize: sizeOf(fullBox).map((v) => round(v)),
  // Site grade, NOT the lowest vertex: one terrain mesh dips far below the pads
  // the plant actually stands on, and a floor placed there leaves the whole works
  // hanging in the air. The 8th percentile of per-object bottoms is the real grade.
  groundY: round(pct(coreMembers.map((i) => i.bounds.min[1]), 0.08) - origin[1]),
  lowestY: round(fullBox.min[1] - origin[1]),
  hull,
  counts: {
    meshesBefore,
    nodesBefore,
    meshesAfter: root.listMeshes().length,
    nodesAfter: root.listNodes().length,
    materials: root.listMaterials().length,
    outliersRemoved: dropped.length,
  },
  removed: dropped.map(({ item, why }) => ({
    name: item.name,
    why,
    center: item.center.map((v) => round(v, 1)),
    size: item.size.map((v) => round(v, 1)),
  })),
  assets,
};
writeFileSync(OUT_META, JSON.stringify(meta, null, 2));

console.log(`meshes      : ${meshesBefore} -> ${meta.counts.meshesAfter}`);
console.log(`core size   : ${meta.coreSize.join(' x ')}   full: ${meta.extentSize.join(' x ')}`);
console.log(`hull cloud  : ${hull.length} points (cell ${cell.toFixed(2)})`);
console.log(`assets      : ${assets.length} -> ${assets.map((a) => a.id).join(' ')}`);
console.log(`wrote       : ${OUT_GLB} (${(glb.byteLength / 1e6).toFixed(1)} MB)  +  ${OUT_META}`);
