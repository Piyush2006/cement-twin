/**
 * Cement process model.
 *
 * Every tag here is a SIMULATED signal with a realistic operating envelope for a
 * ~1.5 Mtpa dry-process line (5-stage preheater + in-line calciner). To drive the
 * twin from real plant data, replace `sim.js` with a feed that publishes the same
 * `{ code -> value }` shape; `unsTopic` is the I/O Sense UNS path each tag would
 * bind to, and is the seam where a live connector plugs in.
 */

export const PLANT = {
  name: 'Integrated Cement Works — Line 1',
  location: 'Dry process · 5-stage preheater · in-line calciner',
  ratedClinker: 3300, // t/day
  shift: 'B',
};

/**
 * Simulated hours advanced per 1 s tick. Silo levels integrate against this, so
 * storage moves at a visible rate; the UI states the factor rather than implying
 * these are wall-clock readings.
 */
export const SIM_HOURS_PER_TICK = 0.2;
export const SIM_SPEED = Math.round(SIM_HOURS_PER_TICK * 3600);

/** Tag limits are [loLo, lo, hi, hiHi]; null disables that limit. */
const t = (code, name, unit, base, swing, limits, decimals = 1, extra = {}) => ({
  code, name, unit, base, swing, limits, decimals,
  unsTopic: `plant1/${extra.area ?? 'pyro'}/${code.toLowerCase()}`,
  ...extra,
});

/**
 * Telemetry profile per equipment class. The geometry pipeline decides which of
 * these exist by what it finds in the model, so adding a class here is inert
 * until a matching asset is detected.
 */
export const PROFILES = {
  preheater: {
    kindLabel: 'Pyroprocessing',
    blurb: 'Five-stage suspension preheater with in-line calciner. Raw meal is heated by counter-current kiln gas before entering the kiln.',
    tags: [
      t('PH_ST1_T', 'Stage-1 outlet gas temp', '°C', 312, 16, [null, 270, 345, 370]),
      t('PH_CALC_T', 'Calciner outlet temp', '°C', 882, 14, [840, 858, 902, 920]),
      t('PH_KILN_IN_T', 'Kiln inlet gas temp', '°C', 1048, 22, [980, 1010, 1085, 1110]),
      t('PH_DRAFT', 'Preheater fan draft', 'kPa', -5.42, 0.22, [-6.6, -6.1, -4.7, -4.3], 2),
      t('PH_O2', 'Preheater outlet O₂', '%', 3.1, 0.3, [1.6, 2.1, 4.2, 4.9], 2),
      t('PH_CO', 'Preheater outlet CO', 'ppm', 165, 60, [null, null, 600, 900], 0),
      t('PH_FEED', 'Kiln feed rate', 't/h', 312, 9, [270, 288, 332, 344], 1),
      t('PH_CALC_DEG', 'Degree of calcination', '%', 94.2, 1.1, [89, 91.5, null, null], 1),
      t('PH_SHC', 'Specific heat consumption', 'kcal/kg', 742, 12, [null, null, 790, 820], 0),
      t('PH_TSR', 'Thermal substitution rate', '%', 14.6, 2.4, [4, 7, null, null], 1),
    ],
  },

  'clinker-silo': {
    kindLabel: 'Clinker Storage',
    blurb: 'Clinker from the grate cooler is conveyed here before cement grinding. Level integrates cooler output against mill draw.',
    capacity: 42000, // t
    tags: [
      t('CLK_LEVEL', 'Silo level', '%', 68, 0, [8, 15, 92, 97], 1, { area: 'clinker', integrating: true }),
      t('CLK_TEMP', 'Clinker temperature', '°C', 108, 9, [null, null, 165, 190], 0, { area: 'clinker' }),
      t('CLK_FREELIME', 'Free lime (f-CaO)', '%', 1.15, 0.28, [0.4, 0.6, 1.7, 2.1], 2, { area: 'quality' }),
      t('CLK_LITREWT', 'Litre weight', 'g/L', 1285, 38, [1150, 1210, 1400, 1450], 0, { area: 'quality' }),
      t('CLK_DRAW', 'Extraction to mills', 't/h', 136, 9, [null, null, null, null], 1, { area: 'clinker' }),
      t('CLK_C3S', 'C₃S content', '%', 61.4, 1.8, [52, 56, 68, 72], 1, { area: 'quality' }),
    ],
  },

  'cement-silo': {
    kindLabel: 'Cement Storage',
    blurb: 'Finished cement silo group. Each cell is tracked independently; extraction feeds packing and bulk dispatch.',
    capacity: 7500, // t per cell
    grades: ['OPC 53', 'OPC 43', 'PPC', 'PSC', 'OPC 53'],
    tags: [
      t('CEM_LEVEL', 'Group level', '%', 61, 0, [6, 12, 94, 98], 1, { area: 'cement', integrating: true }),
      t('CEM_TEMP', 'Cement temperature', '°C', 71, 6, [null, null, 95, 110], 0, { area: 'cement' }),
      t('CEM_BLAINE', 'Blaine fineness', 'cm²/g', 3340, 85, [2900, 3050, 3650, 3800], 0, { area: 'quality' }),
      t('CEM_R45', 'Residue 45 µm', '%', 4.2, 0.7, [null, null, 7.5, 9], 2, { area: 'quality' }),
      t('CEM_EXTRACT', 'Extraction rate', 't/h', 96, 22, [null, null, null, null], 1, { area: 'cement' }),
      t('CEM_SO3', 'SO₃ content', '%', 2.48, 0.16, [1.6, 1.9, 3.2, 3.5], 2, { area: 'quality' }),
    ],
  },

  'pressure-tank': {
    kindLabel: 'Utilities',
    blurb: 'Fire-water pressure vessel for the plant hydrant ring main.',
    tags: [
      t('FW_PRESS', 'Header pressure', 'bar', 7.4, 0.35, [5.5, 6.2, 9.0, 9.8], 2, { area: 'utility' }),
      t('FW_LEVEL', 'Vessel level', '%', 74, 3, [45, 55, 92, 97], 1, { area: 'utility' }),
    ],
  },
};

/**
 * The full process line. `anchor` points at a geometry asset id when the model
 * contains that equipment; stages without one are logical only — the GLB has no
 * geometry for them, and the UI says so rather than inventing a hotspot.
 */
export const STAGES = [
  { id: 'crusher', name: 'Limestone Crusher', tag: 'CRU_TPH', unit: 't/h', base: 820, swing: 60, anchor: null },
  { id: 'rawmill', name: 'Raw Mill', tag: 'RM_TPH', unit: 't/h', base: 335, swing: 18, anchor: null },
  { id: 'preheater', name: 'Preheater & Calciner', tag: 'PH_FEED', unit: 't/h', base: 312, swing: 9, anchor: 'preheater' },
  { id: 'kiln', name: 'Rotary Kiln', tag: 'KILN_TPH', unit: 't/h', base: 139, swing: 5, anchor: null },
  { id: 'cooler', name: 'Clinker Cooler', tag: 'COOL_TPH', unit: 't/h', base: 139, swing: 5, anchor: null },
  { id: 'clinker', name: 'Clinker Silo', tag: 'CLK_DRAW', unit: 't/h', base: 136, swing: 9, anchor: 'clinker-silo' },
  { id: 'cemmill', name: 'Cement Mill', tag: 'CM_TPH', unit: 't/h', base: 178, swing: 12, anchor: null },
  { id: 'cemsilo', name: 'Cement Silos', tag: 'CEM_TOTAL', unit: 't/h', base: 178, swing: 12, anchor: 'cement-silo-1' },
  { id: 'packing', name: 'Packing & Dispatch', tag: 'PACK_TPH', unit: 't/h', base: 168, swing: 20, anchor: null },
];

/** Headline plant KPIs. `derive` reads the simulator's flat tag map. */
export const KPIS = [
  { id: 'clk', label: 'Clinker Output', unit: 't/h', decimals: 1, derive: (s) => s.KILN_TPH, foot: (s) => `${Math.round(s.KILN_TPH * 24)} t/day` },
  { id: 'cem', label: 'Cement Output', unit: 't/h', decimals: 1, derive: (s) => s.CM_TPH, foot: () => 'blended, all grades' },
  { id: 'shc', label: 'Spec. Heat', unit: 'kcal/kg', decimals: 0, derive: (s) => s.PH_SHC, foot: () => 'target ≤ 760' },
  { id: 'spc', label: 'Spec. Power', unit: 'kWh/t', decimals: 1, derive: (s) => s.SPEC_POWER, foot: () => 'target ≤ 78' },
  { id: 'rf', label: 'Kiln Run Factor', unit: '%', decimals: 1, derive: (s) => s.RUN_FACTOR, foot: () => 'rolling 30 d' },
  { id: 'tsr', label: 'Thermal Subst.', unit: '%', decimals: 1, derive: (s) => s.PH_TSR, foot: () => 'AFR share' },
  { id: 'dust', label: 'Stack Dust', unit: 'mg/Nm³', decimals: 1, derive: (s) => s.STACK_DUST, foot: () => 'limit 30' },
  { id: 'nox', label: 'Stack NOx', unit: 'mg/Nm³', decimals: 0, derive: (s) => s.STACK_NOX, foot: () => 'limit 600' },
];

/** Plant-level tags that are not tied to one asset. */
export const PLANT_TAGS = [
  t('CRU_TPH', 'Crusher throughput', 't/h', 820, 60, [null, 500, null, null], 0, { area: 'crushing' }),
  t('RM_TPH', 'Raw mill feed', 't/h', 335, 18, [260, 290, null, null], 1, { area: 'rawmill' }),
  t('KILN_TPH', 'Clinker production', 't/h', 139, 5, [118, 126, null, null], 1),
  t('COOL_TPH', 'Cooler throughput', 't/h', 139, 5, [null, null, null, null], 1),
  t('CM_TPH', 'Cement mill output', 't/h', 178, 12, [140, 155, null, null], 1, { area: 'cement' }),
  t('CEM_TOTAL', 'Silo infeed total', 't/h', 178, 12, [null, null, null, null], 1, { area: 'cement' }),
  t('PACK_TPH', 'Packing rate', 't/h', 168, 20, [null, null, null, null], 1, { area: 'packing' }),
  t('SPEC_POWER', 'Specific power', 'kWh/t', 74.6, 2.2, [null, null, 82, 88], 1, { area: 'energy' }),
  t('RUN_FACTOR', 'Kiln run factor', '%', 92.4, 1.6, [82, 86, null, null], 1),
  t('STACK_DUST', 'Stack dust', 'mg/Nm³', 14.2, 4.5, [null, null, 30, 45], 1, { area: 'emissions' }),
  t('STACK_NOX', 'Stack NOx', 'mg/Nm³', 452, 60, [null, null, 600, 720], 0, { area: 'emissions' }),
  t('STACK_SO2', 'Stack SO₂', 'mg/Nm³', 118, 40, [null, null, 400, 500], 0, { area: 'emissions' }),
  t('KILN_SPEED', 'Kiln speed', 'rpm', 3.42, 0.14, [2.6, 2.9, 4.1, 4.4], 2),
  t('KILN_TORQUE', 'Kiln drive torque', '%', 68, 7, [null, null, 88, 95], 0),
  t('COOL_EFF', 'Cooler recuperation', '%', 73.8, 2.6, [62, 66, null, null], 1, { area: 'energy' }),
];

/** Camera presets, expressed as fractions of the model's core bounding box. */
export const VIEWS = [
  { id: 'overview', label: 'Overview', theta: 0.72, phi: 1.02, dist: 0.92 },
  { id: 'pyro', label: 'Pyro Line', focus: 'preheater', theta: -0.5, phi: 1.12, dist: 1.0 },
  { id: 'silos', label: 'Silo Yard', focus: 'cement-silo-1', theta: 2.2, phi: 1.15, dist: 1.05 },
  { id: 'plan', label: 'Plan', theta: 0.72, phi: 0.1, dist: 1.0 },
];
