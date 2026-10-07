/**
 * Process simulator.
 *
 * Not noise on a sine wave: each tag is a mean-reverting (Ornstein-Uhlenbeck)
 * walk inside its operating envelope, then a coupling pass applies the physical
 * relationships an operator would recognise — feed drives clinker output, a cold
 * calciner raises free lime, poor recuperation raises heat consumption — and
 * silo levels genuinely integrate infeed against extraction.
 *
 * Replace this module to drive the twin from live data: expose `state` (a flat
 * `code -> value` map), `history(code)` and `alarms`, and the UI is unchanged.
 */

import { PROFILES, PLANT_TAGS, STAGES, SIM_HOURS_PER_TICK } from './data/process.js';
import { EQUIPMENT_TAGS, AREA_OEE } from './data/equipment.js';
import { dashboardTags } from './data/kiln-dashboard.js';
import { KPI_TAGS } from './data/area-kpis.js';

// 120 samples at SIM_HOURS_PER_TICK (0.2 h) is 24 simulated hours — the window
// the trend charts plot. Raising it costs one float per tag per sample.
const HISTORY = 120;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Deterministic PRNG so a reload replays comparable conditions. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Simulator {
  /**
   * @param {Array} assets geometry-derived assets from plant-geometry.json
   * @param {number} seed
   */
  constructor(assets, seed = 20261005) {
    this.rand = mulberry32(seed);
    this.assets = assets;
    this.state = {};
    this.hist = new Map();
    this.alarms = [];
    this.tick = 0;
    this.events = [];

    /** @type {Map<string, {code, base, swing, limits, decimals, unit, name, integrating}>} */
    this.defs = new Map();

    // plant-wide tags
    for (const d of PLANT_TAGS) this.#register(d);

    // per-asset tags, namespaced by asset id so two silo groups never collide
    this.assetTags = new Map();
    for (const a of assets) {
      const profile = PROFILES[a.kind];
      if (!profile) continue;
      const codes = [];
      for (const d of profile.tags) {
        const code = `${a.id}:${d.code}`;
        // stagger each asset's starting point so the plant doesn't move in lockstep
        const jitter = (this.rand() - 0.5) * d.swing * 1.4;
        this.#register({ ...d, code, base: d.base + (d.integrating ? jitter * 0 : jitter) });
        codes.push(code);
      }
      this.assetTags.set(a.id, codes);
    }

    // silo cells: one level per physical silo found in the geometry
    this.cells = new Map();
    for (const a of assets) {
      if (a.kind !== 'cement-silo' && a.kind !== 'clinker-silo') continue;
      const profile = PROFILES[a.kind];
      const n = a.kind === 'clinker-silo' ? 1 : a.parts;
      const cells = [];
      for (let i = 0; i < n; i++) {
        const r = this.rand();
        cells.push({
          id: `${a.id}#${i + 1}`,
          name: a.kind === 'clinker-silo' ? 'CLK-01' : `CS-${String(i + 1).padStart(2, '0')}`,
          level: clamp(26 + this.rand() * 58, 8, 92),
          grade: profile.grades ? profile.grades[(i + a.id.length) % profile.grades.length] : 'Clinker',
          capacity: profile.capacity ?? 5000,
          // a silo is either taking mill product, feeding dispatch, or idle
          mode: r < 0.35 ? 'fill' : r < 0.8 ? 'draw' : 'idle',
          rate: 0,
        });
      }
      this.cells.set(a.id, cells);
    }

    // A tag on a one-of-a-kind asset is also a plant-level signal: alias
    // `preheater:PH_SHC` to `PH_SHC` so KPI formulas read naturally.
    this.aliases = [];
    const byKind = new Map();
    for (const a of assets) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    for (const a of assets) {
      if (byKind.get(a.kind) !== 1) continue;
      for (const d of PROFILES[a.kind]?.tags ?? []) {
        if (this.defs.has(d.code)) continue; // never shadow a real plant tag
        this.aliases.push([d.code, `${a.id}:${d.code}`]);
      }
    }

    // Per-area equipment instrumentation. These are what the annotation cards
    // count, so an area's warning/critical figures reflect its own faceplate
    // rather than a couple of borrowed plant-level tags.
    this.areaTags = new Map();
    for (const [areaId, defs] of Object.entries(EQUIPMENT_TAGS)) {
      const codes = [];
      for (const d of defs) {
        const code = `area:${areaId}:${d.code}`;
        // A real plant always carries a few nagging tags sitting on a limit. A
        // pure mean-reverting walk never does — every tag parks on its setpoint
        // and the alarm list stays empty forever. So a seeded minority of tags
        // get a chronic bias toward their nearest limit: those hover in and out
        // of warning, which is what makes the counts move.
        const r = this.rand();
        let base = d.base + (r - 0.5) * d.swing * 1.2;
        if (r < 0.3) {
          const sigma = d.swing * 0.857;
          const [loLo, lo, hi, hiHi] = d.limits ?? [];
          const up = hi ?? hiHi;
          const dn = lo ?? loLo;
          const drift = 1.5 + this.rand() * 1.4; // 1.5–2.9 sigma of chronic offset
          if (up != null && (dn == null || this.rand() < 0.72)) {
            base = Math.min(up + sigma * 0.5, d.base + sigma * drift);
          } else if (dn != null) {
            base = Math.max(dn - sigma * 0.5, d.base - sigma * drift);
          }
        }
        this.#register({ ...d, code, base });
        codes.push(code);
      }
      this.areaTags.set(areaId, codes);
    }

    // Availability / Performance / Quality per area, registered as ordinary tags
    // so they get history and limit checking like everything else. OEE is their
    // product, and the annotation pills show it.
    for (const [areaId, prof] of Object.entries(AREA_OEE)) {
      const mk = (code, name, base, swing, limits, dec) =>
        this.#register({ code: `area:${areaId}:${code}`, name, unit: '%', base, swing, limits, decimals: dec });
      mk('AVAIL', 'Availability', prof.a, 3.2, [55, 70, null, null], 1);
      mk('PERF', 'Performance', prof.p, 3.6, [55, 68, null, null], 1);
      mk('QUAL', 'Quality', prof.q, 0.5, [94, 96.5, null, null], 2);
      mk('OUTPUT', 'Output rate', prof.rated * (prof.p / 100), prof.rated * 0.05, [null, null, null, null], 1);
    }

    // Kiln faceplate tags. Registered like any other so the dashboard reads
    // live; lab results are given a long time constant because they come from
    // a sample, not an instrument.
    for (const d of dashboardTags()) {
      this.#register({
        code: `kd:${d.code}`,
        name: d.label,
        unit: d.unit ?? '',
        base: d.base,
        swing: d.lab ? d.swing * 0.12 : d.swing,
        limits: d.lsl != null ? [null, d.lsl, d.usl, null] : [null, null, null, null],
        decimals: d.decimals ?? 2,
      });
    }

    // Areas the process model leaves uninstrumented still lead with three KPIs
    // on the twin, so their tags are registered here and walked like any other
    // rather than being written into the panel as fixed text.
    for (const d of KPI_TAGS) {
      this.#register({
        code: d.code,
        name: d.name,
        unit: d.unit,
        base: d.base,
        swing: d.swing,
        limits: [null, null, null, null],
        decimals: d.decimals,
      });
    }

    this.#seedHistory();
  }

  #register(d) {
    this.defs.set(d.code, d);
    this.state[d.code] = d.base;
    this.hist.set(d.code, []);
  }

  /** Walk every tag once, then re-apply couplings, so sparklines open populated. */
  #seedHistory() {
    for (let i = 0; i < HISTORY; i++) this.step(1);
    this.alarms = [];
  }

  /** One OU step for a free-running tag. */
  #walk(code, dt) {
    const d = this.defs.get(code);
    if (!d || d.integrating) return;
    const theta = 0.12; // pull back toward base
    const sigma = d.swing * 0.42;
    const prev = this.state[code];
    const next = prev + theta * (d.base - prev) * dt + sigma * (this.rand() * 2 - 1) * Math.sqrt(dt);
    // Bound the walk by its own swing, never by the magnitude of its baseline:
    // a tag like -5.4 kPa draft would otherwise be free to wander ±2 kPa and
    // trip its own critical limits on noise alone.
    const span = d.swing * 3.2;
    this.state[code] = clamp(next, d.base - span, d.base + span);
  }

  /** Occasional process upsets, so the alarm list is earned rather than random. */
  #disturb() {
    this.events = this.events.filter((e) => --e.ttl > 0);
    if (this.rand() < 0.012 && this.events.length < 2) {
      const kinds = [
        { key: 'co', label: 'Reducing conditions in calciner', ttl: 26 },
        { key: 'coating', label: 'Coating build-up in kiln riser', ttl: 34 },
        { key: 'dust', label: 'Bag filter compartment offline', ttl: 22 },
        { key: 'cold', label: 'Cold-run tendency after feed dip', ttl: 30 },
      ];
      this.events.push({ ...kinds[Math.floor(this.rand() * kinds.length)] });
    }
    const has = (k) => this.events.some((e) => e.key === k);
    return { co: has('co'), coating: has('coating'), dust: has('dust'), cold: has('cold') };
  }

  step(dt = 1) {
    this.tick += 1;
    for (const code of this.defs.keys()) this.#walk(code, dt);
    const ev = this.#disturb();
    const S = this.state;
    const ph = this.assets.find((a) => a.kind === 'preheater')?.id;
    const clk = this.assets.find((a) => a.kind === 'clinker-silo')?.id;
    const q = (id, c, fallback = 0) => (id ? S[`${id}:${c}`] ?? fallback : fallback);
    const set = (id, c, v) => { if (id) S[`${id}:${c}`] = v; };

    // ---- couplings -------------------------------------------------------
    // Upsets are sized to push a tag into its warning band; only a sustained
    // event on top of an already-high walk should reach the critical limit.
    if (ev.co) { set(ph, 'PH_CO', q(ph, 'PH_CO') + 320); set(ph, 'PH_O2', q(ph, 'PH_O2') - 0.26); }
    if (ev.coating) { set(ph, 'PH_DRAFT', q(ph, 'PH_DRAFT') - 0.3); set(ph, 'PH_KILN_IN_T', q(ph, 'PH_KILN_IN_T') + 17); }
    if (ev.cold) { set(ph, 'PH_CALC_T', q(ph, 'PH_CALC_T') - 15); }
    if (ev.dust) S.STACK_DUST += 11;

    // kiln feed drives clinker production (≈0.63 t clinker per t meal, with loss)
    const feed = q(ph, 'PH_FEED', 312);
    S.KILN_TPH = feed * 0.445 + (S.KILN_TPH - feed * 0.445) * 0.72;
    S.COOL_TPH = S.KILN_TPH * 0.998;
    S.RM_TPH = feed * 1.07 + (S.RM_TPH - feed * 1.07) * 0.7;

    // a cold calciner under-calcines, which shows up as free lime and litre weight
    const calc = q(ph, 'PH_CALC_T', 882);
    set(ph, 'PH_CALC_DEG', clamp(94.2 + (calc - 882) * 0.05, 84, 98));
    if (clk) {
      S[`${clk}:CLK_FREELIME`] = clamp(1.15 - (calc - 882) * 0.012 + (this.rand() - 0.5) * 0.08, 0.25, 3.2);
      S[`${clk}:CLK_LITREWT`] = clamp(1285 + (calc - 882) * 1.6 + (this.rand() - 0.5) * 18, 1120, 1480);
      S[`${clk}:CLK_C3S`] = clamp(61.4 - (S[`${clk}:CLK_FREELIME`] - 1.15) * 4.2, 48, 74);
    }

    // poor cooler recuperation and low TSR both push heat consumption up
    set(ph, 'PH_SHC', clamp(742 + (73.8 - S.COOL_EFF) * 3.1 - (q(ph, 'PH_TSR', 14.6) - 14.6) * 1.4, 690, 860));
    S.SPEC_POWER = clamp(74.6 + (3340 - this.#avgBlaine()) * -0.0032 + (this.rand() - 0.5) * 0.5, 66, 92);

    // NOx tracks burning-zone temperature; CO and NOx trade off
    S.STACK_NOX = clamp(452 + (q(ph, 'PH_KILN_IN_T', 1048) - 1048) * 1.9 - (q(ph, 'PH_CO', 165) - 165) * 0.08, 180, 900);

    // ---- silo integration ------------------------------------------------
    // Mass balance runs forwards: the mills produce, the silos buffer, dispatch
    // draws down. Each cell is either taking product, feeding out, or idle, and
    // flips mode at the ends of travel — so the group level is a real integral.
    const hrs = SIM_HOURS_PER_TICK * dt;

    // cement mill is limited by clinker on the ground, not the other way round
    const clkLevel = clk ? S[`${clk}:CLK_LEVEL`] ?? 60 : 60;
    if (clkLevel < 12) S.CM_TPH = Math.min(S.CM_TPH, 120 + clkLevel * 4);
    S.CM_TPH = clamp(S.CM_TPH, 110, 235);
    S.PACK_TPH = clamp(S.PACK_TPH, 80, 240);
    S.CRU_TPH = clamp(S.CRU_TPH, 420, 1000);
    set(clk, 'CLK_DRAW', clamp(S.CM_TPH * 0.765 + (this.rand() - 0.5) * 3, 90, 180));

    for (const [assetId, cells] of this.cells) {
      const asset = this.assets.find((a) => a.id === assetId);
      const isClinker = asset.kind === 'clinker-silo';

      // flip modes: at the ends of travel always, otherwise occasionally
      for (const c of cells) {
        if (c.level > 93) c.mode = 'draw';
        else if (c.level < 9) c.mode = 'fill';
        else if (this.rand() < 0.015) c.mode = c.mode === 'fill' ? 'draw' : 'fill';
      }

      const infeed = isClinker ? S.COOL_TPH : S.CM_TPH;
      const outfeed = isClinker ? q(clk, 'CLK_DRAW', 136) : S.PACK_TPH * 0.58 + S.CM_TPH * 0.42;
      const filling = cells.filter((c) => c.mode === 'fill');
      const drawing = cells.filter((c) => c.mode === 'draw');
      // if every cell wants the same thing, the line still has to balance
      const fillEach = filling.length ? infeed / filling.length : 0;
      const drawEach = drawing.length ? outfeed / drawing.length : 0;

      let sumLevel = 0;
      let stock = 0;
      for (const c of cells) {
        c.rate = c.mode === 'fill' ? fillEach : c.mode === 'draw' ? -drawEach : 0;
        c.level = clamp(c.level + (c.rate * hrs) / c.capacity * 100, 1.5, 99);
        sumLevel += c.level;
        stock += (c.level / 100) * c.capacity;
      }
      const avg = sumLevel / cells.length;
      if (isClinker) {
        S[`${assetId}:CLK_LEVEL`] = avg;
        S[`${assetId}:CLK_STOCK`] = stock;
      } else {
        S[`${assetId}:CEM_LEVEL`] = avg;
        S[`${assetId}:CEM_STOCK`] = stock;
        S[`${assetId}:CEM_EXTRACT`] = drawing.length * drawEach;
      }
    }
    S.CEM_TOTAL = S.CM_TPH;

    for (const [alias, src] of this.aliases) S[alias] = S[src];

    // aggregate across the silo groups, for plant-level readouts
    const cemIds = this.assets.filter((a) => a.kind === 'cement-silo').map((a) => a.id);
    if (cemIds.length) {
      S.CEM_LEVEL_AVG = cemIds.reduce((t, id) => t + (S[`${id}:CEM_LEVEL`] ?? 0), 0) / cemIds.length;
      S.CEM_STOCK_TOTAL = cemIds.reduce((t, id) => t + (S[`${id}:CEM_STOCK`] ?? 0), 0);
    }

    for (const st of STAGES) if (S[st.tag] === undefined) S[st.tag] = st.base;

    // ---- history + alarms ------------------------------------------------
    for (const [code, h] of this.hist) {
      h.push(this.state[code]);
      if (h.length > HISTORY) h.shift();
    }
    this.#evaluate();
    return this.state;
  }

  #avgBlaine() {
    const vals = [...this.defs.keys()].filter((c) => c.endsWith(':CEM_BLAINE')).map((c) => this.state[c]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3340;
  }

  /** Severity for one tag against its [loLo, lo, hi, hiHi] limits. */
  severity(code) {
    const d = this.defs.get(code);
    if (!d || !d.limits) return 'good';
    const [loLo, lo, hi, hiHi] = d.limits;
    const v = this.state[code];
    if ((hiHi != null && v >= hiHi) || (loLo != null && v <= loLo)) return 'crit';
    if ((hi != null && v >= hi) || (lo != null && v <= lo)) return 'warn';
    return 'good';
  }

  #evaluate() {
    const now = new Date();
    const active = [];
    for (const code of this.defs.keys()) {
      const sev = this.severity(code);
      if (sev === 'good') continue;
      const d = this.defs.get(code);
      const prior = this.alarms.find((a) => a.code === code);
      active.push({
        code,
        sev,
        assetId: code.includes(':') ? code.split(':')[0] : null,
        name: d.name,
        value: this.state[code],
        unit: d.unit,
        decimals: d.decimals,
        since: prior?.since ?? now,
      });
    }
    const rank = { crit: 0, warn: 1 };
    this.alarms = active.sort((a, b) => rank[a.sev] - rank[b.sev] || +b.since - +a.since);
  }

  history(code) { return this.hist.get(code) ?? []; }

  /** Tonnes held in a storage asset, derived from the integrated cell levels. */
  stockOf(assetId) {
    return this.state[`${assetId}:CEM_STOCK`] ?? this.state[`${assetId}:CLK_STOCK`] ?? null;
  }
  def(code) { return this.defs.get(code); }

  /**
   * Live OEE for one area. Availability is pulled down when its equipment is in
   * a critical state, so a red alarm list and a falling OEE agree with each
   * other rather than drifting independently.
   */
  oeeOfArea(areaId) {
    const prof = AREA_OEE[areaId];
    if (!prof) return null;
    const g = (c) => this.state[`area:${areaId}:${c}`];
    const { crit } = this.countsOfArea(areaId);
    const a = clamp(g('AVAIL') - crit * 2.4, 20, 100);
    const p = clamp(g('PERF'), 20, 100);
    const q = clamp(g('QUAL'), 50, 100);
    return {
      a, p, q,
      oee: (a * p * q) / 10000,
      output: g('OUTPUT'),
      rated: prof.rated,
      unit: prof.unit,
      product: prof.product,
    };
  }

  /**
   * Composite assessment of one area — the figures BRUCE reports when asked how
   * an area is doing.
   *
   * Every number is DERIVED from tags this simulator already walks, by a stated
   * formula; none is invented for display. Where a figure has no basis in the
   * model it comes back null and the caller omits it rather than inventing one.
   *
   *   health      100, less 6 per critical and 2 per warning tag, less the
   *               shortfall below an 85 % OEE target
   *   hotSpots    shell pyrometer zones currently above their high limit
   *   refractory  100, less 7 per hot spot and a penalty for how far the
   *               hottest zone sits above its nominal band
   */
  assessArea(areaId) {
    const g = (c) => this.state[`area:${areaId}:${c}`];
    const { warn, crit } = this.countsOfArea(areaId);
    const oee = this.oeeOfArea(areaId);

    const health = oee
      ? clamp(100 - crit * 6 - warn * 2 - Math.max(0, 85 - oee.oee) * 0.6, 0, 100)
      : null;

    const zones = this.tagsOfArea(areaId)
      .filter((c) => /:SHELL_Z\d$/.test(c))
      .map((c) => ({ code: c, name: this.def(c).name, value: this.state[c], hi: this.def(c).limits?.[2] }));
    const hotSpots = zones.filter((z) => z.hi != null && z.value >= z.hi);
    const maxZone = zones.length ? zones.reduce((a, z) => (z.value > a.value ? z : a)) : null;
    const refractory = zones.length
      ? clamp(100 - hotSpots.length * 7 - Math.max(0, maxZone.value - 300) * 0.35, 0, 100)
      : null;

    // Specific energy: heat for the pyro line, electrical elsewhere.
    const sec = areaId === 'kiln'
      ? { value: this.state.PH_SHC, unit: 'kcal/kg', label: 'Specific heat consumption' }
      : { value: this.state.SPEC_POWER, unit: 'kWh/t', label: 'Specific power' };

    const anomalies = this.tagsOfArea(areaId)
      .map((c) => ({ code: c, sev: this.severity(c) }))
      .filter((x) => x.sev !== 'good')
      .map((x) => ({
        name: this.def(x.code).name,
        sev: x.sev,
        value: this.state[x.code],
        unit: this.def(x.code).unit,
        decimals: this.def(x.code).decimals,
      }))
      .sort((a, b) => (a.sev === 'crit' ? -1 : 1) - (b.sev === 'crit' ? -1 : 1));

    return {
      health,
      refractory,
      hotSpots: zones.length ? hotSpots.length : null,
      hotSpotZones: hotSpots.map((z) => z.name),
      shellT: maxZone ? maxZone.value : (g('SHELL_T') ?? null),
      sec,
      production: oee ? { output: oee.output, rated: oee.rated, unit: oee.unit } : null,
      oee: oee?.oee ?? null,
      warn,
      crit,
      anomalies,
    };
  }

  /** Plant-level headline figures for the twin's overview strip. */
  plantKpis(areaIds) {
    const scored = areaIds.map((id) => this.assessArea(id)).filter((a) => a.health != null);
    const health = scored.length ? scored.reduce((t, a) => t + a.health, 0) / scored.length : null;
    const withOee = areaIds.map((id) => this.oeeOfArea(id)).filter(Boolean);
    return {
      health,
      oee: withOee.length ? withOee.reduce((t, o) => t + o.oee, 0) / withOee.length : null,
      production: { value: this.state.CM_TPH, unit: 't/h', perDay: this.state.CM_TPH * 24 },
      energy: { sec: this.state.PH_SHC, power: this.state.SPEC_POWER },
    };
  }

  /** Tag codes instrumenting one plant area. */
  tagsOfArea(areaId) { return this.areaTags.get(areaId) ?? []; }

  /** Live warning / critical counts for one plant area. */
  countsOfArea(areaId) {
    let warn = 0;
    let crit = 0;
    for (const code of this.tagsOfArea(areaId)) {
      const sev = this.severity(code);
      if (sev === 'crit') crit += 1;
      else if (sev === 'warn') warn += 1;
    }
    return { warn, crit };
  }

  /** Worst severity across an asset's tags — drives the rail and hotspot state. */
  assetSeverity(assetId) {
    const codes = this.assetTags.get(assetId) ?? [];
    let worst = 'good';
    for (const c of codes) {
      const s = this.severity(c);
      if (s === 'crit') return 'crit';
      if (s === 'warn') worst = 'warn';
    }
    return worst;
  }

  cellsOf(assetId) { return this.cells.get(assetId) ?? []; }
}
