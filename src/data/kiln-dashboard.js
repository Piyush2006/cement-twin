/**
 * The Kiln operator dashboard.
 *
 * Layout and tag set for the pyro-line faceplate. Everything here is SIMULATED,
 * like the rest of the twin: each metric is an ordinary tag the simulator walks,
 * so the dashboard reads live rather than showing a frozen picture.
 *
 * `lsl` / `sp` / `usl` are the lower spec limit, set point and upper spec limit
 * drawn on each bar; the delta shown beside a value is its distance from set
 * point, which is what an operator is actually steering on.
 */

const m = (code, label, unit, base, swing, lsl, sp, usl, decimals = 2, chips = []) =>
  ({ code, label, unit, base, swing, lsl, sp, usl, decimals, chips });

const chip = (label, code, unit, base, swing, decimals = 2) =>
  ({ label, code, unit, base, swing, decimals });

/** Lab results, refreshed far less often than process tags. */
export const RAW_MIX = [
  { code: 'R90', label: '90µ (<22)', base: 20.2, swing: 1.1, decimals: 2, age: '2 days ago' },
  { code: 'R212', label: '212µ (>3.20)', base: 3.2, swing: 0.35, decimals: 2, age: '2 days ago' },
  { code: 'SIO2', label: 'SiO2', base: 12.13, swing: 0.3, decimals: 2, age: '29 min ago' },
  { code: 'AL2O3', label: 'Al2O3', base: 4.04, swing: 0.12, decimals: 2, age: '29 min ago' },
  { code: 'FE2O3', label: 'Fe2O3', base: 3.01, swing: 0.1, decimals: 2, age: '29 min ago' },
  { code: 'CAO', label: 'CaO', base: 43.17, swing: 0.4, decimals: 2, age: '29 min ago' },
  { code: 'MGO', label: 'MgO', base: 13.18, swing: 0.3, decimals: 2, age: '29 min ago' },
  { code: 'SO3', label: 'SO3', base: 0.11, swing: 0.03, decimals: 2, age: '29 min ago' },
  { code: 'NA2O', label: 'Na2O', base: 0.16, swing: 0.03, decimals: 2, age: '29 min ago' },
  { code: 'K2O', label: 'K2O', base: 0.27, swing: 0.04, decimals: 2, age: '29 min ago' },
  { code: 'CL', label: 'Cl', base: 0.02, swing: 0.01, decimals: 2, age: '29 min ago' },
  { code: 'LSF', label: 'LSF', base: 106.09, swing: 1.4, decimals: 2, age: '29 min ago' },
  { code: 'SM', label: 'SM', base: 1.72, swing: 0.06, decimals: 2, age: '29 min ago' },
  { code: 'AM', label: 'AM', base: 35.08, swing: 0.6, decimals: 2, age: '58 days ago' },
  { code: 'LOI', label: 'LOI', base: 35.14, swing: 0.6, decimals: 2, age: '50 days ago' },
];

export const SECTIONS = [
  {
    no: 1, name: 'Preheater', icon: 'tower',
    metrics: [
      m('PH1_FAN', 'PH1 String Fan RPM', 'RPM', 765.26, 2.4, 761.85, 767.2, 772.54, 2, [
        chip('PH1 O2', 'PH1_O2', '%', 2.83, 0.18),
        chip('Kiln Inlet O2', 'KILN_IN_O2', '%', 3.78, 0.2),
      ]),
      m('PH2_FAN', 'PH2 String Fan RPM', 'RPM', 768.83, 2.4, 764.37, 769.69, 775.02, 2, [
        chip('PH2 O2', 'PH2_O2', '%', 3.81, 0.2),
        chip('Kiln Inlet O2', 'KILN_IN_O2', '%', 3.78, 0.2),
      ]),
    ],
  },
  {
    no: 2, name: 'Cooler', icon: 'fan',
    metrics: [
      m('FAN5_FLOW', 'Fan5 Flow', 'Nm³/h', 512.76, 18, 493.99, 549.91, 629.72, 2, [
        chip('Sec Air T (SAT)', 'SAT', '°C', 941.92, 14, 2),
        chip('Tert Air T (TAT)', 'TAT', '°C', 776.63, 12, 2),
        chip('FN5 UG Press.', 'FN5_UG', 'mbar', -100.9, 5, 2),
      ]),
    ],
  },
  {
    no: 3, name: 'Calciner', icon: 'flame',
    metrics: [
      m('PC_TEMP', 'PC Temperature', '°C', 872.21, 7, 856.77, 866.61, 876.46, 2, [
        chip('PC Coal', 'PC_COAL', 'TPH', 18.26, 0.7),
      ]),
      m('LOWNOX_TEMP', 'LowNOx Temperature', '°C', 872.21, 7, 856.77, 866.61, 876.46, 2, [
        chip('Low NOx Coal', 'LOWNOX_COAL', 'TPH', 17.98, 0.7),
      ]),
    ],
  },
  {
    no: 4, name: 'Burning Zone', icon: 'flame',
    metrics: [
      m('BZT', 'BZT', '°C', 1237.51, 22, 1072.01, 1153.8, 1235.59, 2, [
        chip('Kiln RPM', 'KILN_RPM', 'RPM', 5.61, 0.12),
        chip('Kiln Filling %', 'KILN_FILL', '%', 14.0, 0.5),
      ]),
    ],
  },
  {
    no: 5, name: 'Solid AFR', icon: 'leaf',
    metrics: [m('AFR_TPH', 'Solid AFR TPH', 'TPH', 10.84, 0.6, 9.86, 11.7, 13.54)],
  },
  {
    no: 6, name: 'Kiln Feed', icon: 'trend',
    metrics: [m('KILN_FEED', 'Kiln Feed', 'TPH', 540.64, 2.0, 538.28, 540.64, 543.0)],
  },
];

/** Lab-derived checks, flagged against their expected band. */
export const QUALITY_CONTEXT = [
  { code: 'C3S', label: 'C3S', base: 41.35, swing: 1.6, decimals: 2, lo: 55, hi: 68 },
  { code: 'CALC_PCT', label: 'Calcination Percentage', base: 86.47, swing: 1.8, decimals: 2, lo: 92, hi: 97 },
  { code: 'CALC_SO3', label: 'Calcination SO3', base: 1.16, swing: 0.12, decimals: 2, lo: 1.6, hi: 3.2 },
  { code: 'CALC_CL', label: 'Calcination Cl', base: 0.59, swing: 0.08, decimals: 2, lo: 0.1, hi: 0.5 },
];

/** The two headline gauges, each against its plant target. */
export const INDICATORS = [
  { code: 'SHC_G', label: 'SHC', unit: 'kcal/kg', base: 823.84, swing: 9, min: 645, max: 725, target: 685.49, decimals: 2 },
  { code: 'TSR_G', label: 'TSR', unit: '%', base: 13.37, swing: 0.8, min: 11, max: 21, target: 16.19, decimals: 2 },
];

/**
 * Callouts positioned over `public/kiln.png`, in % of the image box.
 *
 * Coordinates follow the drawing's own features — the two preheater strings and
 * their cyclone stages, the tertiary air duct, the kiln inlet, the shell, and
 * the cooler end — so a reading sits on the equipment it came from.
 */
export const SCHEMATIC = [
  { code: 'PH1_O2', label: 'PH String-1 O2', unit: '%', x: 20, y: 9 },
  { code: 'PH2_O2', label: 'PH String-2 O2', unit: '%', x: 50, y: 4 },
  { code: 'PH_CON1_T', label: 'PH1 Stage-1 Ext Temp', unit: '\u00b0C', base: 279.8, swing: 6, x: 14, y: 23 },
  { code: 'PH_CON2_T', label: 'PH2 Stage-1 Ext Temp', unit: '\u00b0C', base: 283.9, swing: 6, x: 52, y: 17 },
  { code: 'PH_CON1B_T', label: 'PH1 Stage-3 Ext Temp', unit: '\u00b0C', base: 269.8, swing: 6, x: 13, y: 52 },
  { code: 'PH_CON2B_T', label: 'PH2 Stage-3 Ext Temp', unit: '\u00b0C', base: 271.6, swing: 6, x: 49, y: 44 },
  { code: 'TAT', label: 'TAD', unit: '\u00b0C', x: 46, y: 64 },
  { code: 'FN5_UG', label: 'Fan Outlet Pressure', unit: 'Nm\u00b3/h', x: 13, y: 76 },
  { code: 'KILN_IN_O2', label: 'Kiln Inlet O2', unit: '%', x: 55, y: 78 },
  { code: 'KILN_RPM', label: 'Kiln RPM', unit: 'RPM', x: 74, y: 85 },
  { code: 'KILN_FILL', label: 'Kiln Filling %', unit: '%', x: 90, y: 72 },
  { code: 'SAT', label: 'Secondary Air Temp', unit: '\u00b0C', x: 93, y: 93 },
];

/**
 * Clickable regions on the illustration.
 *
 * `points` are percentages of the image box, traced over the drawing's own
 * features, so a highlight lands on the equipment rather than a rough rectangle.
 * `section` is the dashboard card the region opens.
 */
export const REGIONS = [
  {
    id: 'preheater', label: 'Preheater', section: 1, chip: { x: 20, y: 44 },
    points: [[10, 18], [26, 0], [58, 0], [58, 60], [50, 90], [30, 97], [21, 70], [10, 58]],
  },
  {
    id: 'calciner', label: 'Calciner', section: 3, chip: { x: 54, y: 72 },
    points: [[44, 60], [64, 63], [65, 96], [45, 96]],
  },
  {
    id: 'kiln', label: 'Kiln', section: 4, chip: { x: 80, y: 80 },
    points: [[62, 92], [68, 77], [96, 64], [100, 71], [99, 82], [70, 95]],
  },
  {
    id: 'cooler', label: 'Cooler', section: 2, chip: { x: 94, y: 57 },
    points: [[89, 63], [100, 65], [100, 86], [87, 84]],
  },
];

/** Every tag the dashboard needs, flattened for the simulator to register. */
export function dashboardTags() {
  const out = new Map();
  const add = (d) => { if (!out.has(d.code)) out.set(d.code, d); };
  for (const r of RAW_MIX) add({ ...r, unit: '', lab: true });
  for (const s of SECTIONS) {
    for (const met of s.metrics) {
      add(met);
      for (const c of met.chips) add(c);
    }
  }
  for (const q of QUALITY_CONTEXT) add(q);
  for (const i of INDICATORS) add(i);
  for (const c of SCHEMATIC) if (c.base != null) add(c);
  return [...out.values()];
}
