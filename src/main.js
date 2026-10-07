/**
 * Entry point: boot the stage, load the plant, start the simulator, wire the HUD.
 *
 * The twin is the whole screen. Telemetry still runs — it feeds the live value on
 * each hotspot pin — but the dashboard panels are not mounted.
 */

import './styles.css';
import meta from './data/plant-geometry.json';
import { PlantViewer } from './viewer.js';
import { Simulator } from './sim.js';
import { Stage } from './stage.js';
import { Bruce } from './bruce.js';
import { KilnDashboard } from './dashboard.js';
import { VIEWS, PROFILES } from './data/process.js';
import { ALL_AREAS } from './data/areas.js';


const MODEL_URL = `${import.meta.env.BASE_URL}models/plant.glb`;
const boot = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');
const app = document.getElementById('app');

const setBoot = (pct, msg) => {
  if (pct != null) bootFill.style.transform = `scaleX(${Math.min(1, Math.max(0, pct)).toFixed(3)})`;
  if (msg) bootStatus.textContent = msg;
};

/**
 * Alarm counts for one plant area: how many of its simulated tags are currently
 * outside their limits. Areas with no tags — packaging and the utilities — carry
 * no alarm row at all, matching the reference dashboard.
 */
/**
 * Everything one annotation shows: live OEE and its A/P/Q parts, output against
 * rate and alarm counts.
 */
function areaStatus(sim, area) {
  const a = sim.assessArea(area.id);
  const oee = sim.oeeOfArea(area.id);
  const health = a.health;
  return {
    health,
    healthBand: health == null ? 'none' : health >= 85 ? 'good' : health >= 70 ? 'warn' : 'crit',
    output: oee?.output ?? null,
    rated: oee?.rated ?? null,
    unit: oee?.unit ?? '',
    sec: a.sec?.value ?? null,
    secUnit: a.sec?.unit ?? '',
    costMtd: area.costMtd,
    // only the kiln has a faceplate built so far
    hasDashboard: area.id === 'kiln',
  };
}

async function start() {
  // Drop any asset class the process model has no telemetry for, so a pin is
  // never shown without a value behind it.
  const assets = meta.assets.filter((a) => PROFILES[a.kind]);
  const model = { ...meta, assets };

  setBoot(0.05, 'Building stage…');
  const sim = new Simulator(assets);

  const stage = new Stage(app);

  // Built before the tick loop that drives it: the loop calls update() on the
  // first pass, so a later construction leaves the first tick throwing.
  const dashboard = new KilnDashboard(app, { sim, onClose: () => viewer.resize() });

  const viewer = new PlantViewer(stage.stageEl, model, ALL_AREAS, VIEWS, {
    onOpenDashboard: () => dashboard.open(),
  });

  stage.onAnnotations((on) => viewer.setHotspots(on));
  setBoot(0.15, 'Streaming plant geometry…');
  let stats;
  try {
    stats = await viewer.load(MODEL_URL, (frac, bytes) => {
      if (frac != null) setBoot(0.15 + frac * 0.75, `Streaming plant geometry… ${Math.round(frac * 100)}%`);
      else if (bytes) setBoot(null, `Streaming plant geometry… ${(bytes / 1e6).toFixed(1)} MB`);
    });
  } catch (err) {
    setBoot(1, `Could not load ${MODEL_URL} — ${err.message}`);
    bootStatus.style.color = '#cf2a42';
    throw err;
  }

  setBoot(0.98, 'Starting telemetry…');

  // --- loops: render every frame, simulate once a second
  const loop = (now) => {
    viewer.render(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const tick = () => {
    sim.step(1);
    dashboard.update();
    viewer.setAreaData((id) => {
      const area = ALL_AREAS.find((a) => a.id === id);
      return area ? areaStatus(sim, area) : null;
    });
  };
  tick();
  setInterval(tick, 1000);

  // --- reveal
  app.setAttribute('aria-busy', 'false');
  setBoot(1, 'Ready');
  requestAnimationFrame(() => {
    boot.setAttribute('hidden-fade', '');
    setTimeout(() => boot.remove(), 500);
  });

  // keyboard: 1-4 jump between camera presets, Esc clears selection
  addEventListener('keydown', (e) => {
    // Only text entry swallows the shortcuts — the annotation checkbox is an
    // <input> too, and focusing it must not kill every key on the page.
    if (e.target.matches('textarea, input:not([type=checkbox]):not([type=radio])')) return;
    // presets kept on the number keys after their buttons were removed
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) viewer.frame(VIEWS[n - 1], VIEWS);
    // the switch is the visible control; the key is the shortcut for it, and
    // has to write back so the two never disagree
    if (e.key.toLowerCase() === 'a') {
      viewer.setHotspots(!viewer.showHotspots);
      stage.setAnnotations(viewer.showHotspots);
    }
    if (e.key === 'Escape') {
      if (dashboard.isOpen) dashboard.close();
      else if (viewer.openId) viewer.closeDetail();
      else viewer.select(null);
    }
  });

  // Ask Bruce answers from this simulator, so it can only ever report what the
  // page is actually showing.
  const bruce = new Bruce(stage.stageEl, {
    sim,
    areas: ALL_AREAS,
    onFocusArea: (id) => viewer.toggleDetail(id),
  });

  // the panel shares the grid with the stage, so the canvas must re-measure
  new ResizeObserver(() => viewer.resize()).observe(stage.stageEl);

  Object.assign(globalThis, { __twin: { sim, viewer, stage, bruce, dashboard, meta: model } });
}

start().catch((err) => {
  console.error(err);
  bootStatus.textContent = String(err.message ?? err);
  bootStatus.style.color = '#cf2a42';
});
