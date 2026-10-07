/**
 * The three KPIs each area leads with.
 *
 * An operator should be able to read the condition of a piece of equipment off
 * the twin before opening BRUCE. Three figures is what fits that glance: what
 * it is making, how hard it is working for it, and whether it is fit to keep
 * going. The detailed parameters stay where they were — in the faceplate and
 * in BRUCE.
 *
 * Values are read from the simulator at render time, exactly like every other
 * number on the twin. Three areas carry no OEE instrumentation in the process
 * model (packaging and the two utilities), so their tags are registered here
 * and walked like any other rather than being written as fixed text.
 */

/** Extra tags for the areas the process model leaves uninstrumented. */
export const KPI_TAGS = [
  { code: 'PACK_TPH', name: 'Packing throughput', unit: 't/h', base: 182, swing: 7, decimals: 1 },
  { code: 'PACK_EFF', name: 'Packing efficiency', unit: '%', base: 94.2, swing: 1.6, decimals: 1 },
  { code: 'PACK_AVAIL', name: 'Packing availability', unit: '%', base: 91.5, swing: 2.4, decimals: 1 },

  { code: 'PUMP_MWH', name: 'Pump house energy', unit: 'MWh', base: 4.72, swing: 0.28, decimals: 2 },
  { code: 'PUMP_SEC', name: 'Pump house specific energy', unit: 'kWh/t', base: 6.4, swing: 0.4, decimals: 1 },
  { code: 'PUMP_AVAIL', name: 'Pump house availability', unit: '%', base: 97.1, swing: 1.4, decimals: 1 },

  { code: 'COMP_MWH', name: 'Compressor energy', unit: 'MWh', base: 6.18, swing: 0.34, decimals: 2 },
  { code: 'COMP_SEC', name: 'Compressor specific energy', unit: 'kWh/t', base: 8.9, swing: 0.5, decimals: 1 },
  { code: 'COMP_AVAIL', name: 'Compressor availability', unit: '%', base: 95.3, swing: 1.8, decimals: 1 },
];

for (const [areaId, base] of Object.entries({
  'ls-crusher': 1.68, 'raw-mill': 17.9, 'ball-mill': 32.6,
  'coal-mill': 38.4, 'cement-mill': 31.5, 'slag-mill': 41.6,
})) {
  KPI_TAGS.push({
    code: `spc:${areaId}`, name: 'Specific power', unit: 'kWh/t',
    base, swing: base * 0.045, decimals: areaId === 'ls-crusher' ? 2 : 1,
  });
}

/**
 * Per-area specific power.
 *
 * The process model carries ONE plant-wide `SPEC_POWER` tag (~74 kWh/t of
 * cement, a whole-plant figure). Showing that on every mill and calling it
 * that mill's specific power would be wrong — a crusher draws about 1.6 kWh/t
 * and a slag mill about 42 — so each area gets its own tag, walked like the
 * rest. The plant-wide tag is untouched and still drives the assessments.
 */
const SPC_BASE = {
  'ls-crusher': 1.68, 'raw-mill': 17.9, 'ball-mill': 32.6,
  'coal-mill': 38.4, 'cement-mill': 31.5, 'slag-mill': 41.6,
};
export const SPC_CODE = (areaId) => `spc:${areaId}`;

/** Plant target for specific heat consumption, shared with the kiln faceplate. */
const SHC_TARGET = 685.49;
/** Specific power targets, per area, kWh/t of that area's own product. */
const POWER_TARGET = {
  'ls-crusher': 1.6, 'raw-mill': 17.5, 'ball-mill': 32.0,
  'coal-mill': 38.0, 'cement-mill': 31.0, 'slag-mill': 42.0,
};

// ---- status vocabularies -----------------------------------------------
// Each returns [word, band]. Bands drive colour only; the word is what the
// operator reads, so it names the condition rather than repeating the number.

const pctOfRated = (v, rated) => (rated ? (v / rated) * 100 : null);

const rateStatus = (v, rated) => {
  const p = pctOfRated(v, rated);
  if (p == null) return ['—', 'none'];
  if (p >= 90) return ['At rate', 'good'];
  if (p >= 70) return [`${p.toFixed(0)}% of rated`, 'warn'];
  return [`${p.toFixed(0)}% of rated`, 'crit'];
};

const availStatus = (v) => {
  if (v == null) return ['—', 'none'];
  if (v >= 90) return ['Available', 'good'];
  if (v >= 75) return ['Reduced', 'warn'];
  return ['Constrained', 'crit'];
};

const healthStatus = (v) => {
  if (v == null) return ['—', 'none'];
  if (v >= 85) return ['Healthy', 'good'];
  if (v >= 70) return ['Fair', 'warn'];
  return ['Degraded', 'crit'];
};

const refractoryStatus = (v) => {
  if (v == null) return ['—', 'none'];
  if (v >= 85) return ['Good', 'good'];
  if (v >= 70) return ['Monitor', 'warn'];
  return ['Attention', 'crit'];
};

/** Energy is the one KPI where lower is better, so it states the direction. */
const againstTarget = (v, target) => {
  if (v == null || target == null) return ['—', 'none'];
  const over = ((v - target) / target) * 100;
  if (over > 5) return ['↑ Above target', 'crit'];
  if (over > 0) return ['↑ Slightly above', 'warn'];
  return ['↓ On target', 'good'];
};

const effStatus = (v) => {
  if (v == null) return ['—', 'none'];
  if (v >= 93) return ['On plan', 'good'];
  if (v >= 85) return ['Below plan', 'warn'];
  return ['Off plan', 'crit'];
};

// ---- KPI shapes ---------------------------------------------------------

const kpi = (label, value, unit, decimals, status) => ({ label, value, unit, decimals, status });

/** Mills, the crusher and the kiln all read from the process model. */
function fromOee({ oee, state }, { areaId, rateLabel, powerTarget }) {
  const spc = state?.[SPC_CODE(areaId)] ?? null;
  return [
    kpi(rateLabel, oee?.output ?? null, oee?.unit ?? 't/h', 1, rateStatus(oee?.output, oee?.rated)),
    kpi('Specific power', spc, 'kWh/t', areaId === 'ls-crusher' ? 2 : 1, againstTarget(spc, powerTarget)),
    kpi('Availability', oee?.a ?? null, '%', 1, availStatus(oee?.a)),
  ];
}

/**
 * Which three KPIs an area leads with.
 *
 * `ctx` carries the area's OEE profile, its assessment, and the raw tag state,
 * so every figure here is the one the rest of the twin is already showing.
 */
export function areaKpis(areaId, ctx) {
  const { oee, assess, state } = ctx;
  const S = (c) => state?.[c] ?? null;

  switch (areaId) {
    case 'ls-crusher':
      return fromOee(ctx, { areaId, rateLabel: 'Throughput', powerTarget: POWER_TARGET['ls-crusher'] });
    case 'raw-mill':
      return fromOee(ctx, { areaId, rateLabel: 'Raw meal production', powerTarget: POWER_TARGET['raw-mill'] });
    case 'coal-mill':
      return fromOee(ctx, { areaId, rateLabel: 'Coal throughput', powerTarget: POWER_TARGET['coal-mill'] });
    case 'cement-mill':
      return fromOee(ctx, { areaId, rateLabel: 'Cement production', powerTarget: POWER_TARGET['cement-mill'] });
    case 'ball-mill':
      return fromOee(ctx, { areaId, rateLabel: 'Clinker production', powerTarget: POWER_TARGET['ball-mill'] });
    case 'slag-mill':
      return fromOee(ctx, { areaId, rateLabel: 'Slag production', powerTarget: POWER_TARGET['slag-mill'] });

    // The pyro line leads with heat and condition, not rate: an operator
    // steering the kiln is steering fuel and refractory, and the clinker rate
    // follows from them.
    case 'kiln':
      return [
        kpi('SHC', assess?.sec?.value ?? null, 'kcal/kg', 2, againstTarget(assess?.sec?.value, SHC_TARGET)),
        kpi('Kiln health', assess?.health ?? null, '/100', 0, healthStatus(assess?.health)),
        kpi('Refractory health', assess?.refractory ?? null, '/100', 0, refractoryStatus(assess?.refractory)),
      ];

    case 'packaging':
      return [
        kpi('Packing throughput', S('PACK_TPH'), 't/h', 1, rateStatus(S('PACK_TPH'), 200)),
        kpi('Packing efficiency', S('PACK_EFF'), '%', 1, effStatus(S('PACK_EFF'))),
        kpi('Availability', S('PACK_AVAIL'), '%', 1, availStatus(S('PACK_AVAIL'))),
      ];

    case 'pump-house':
      return [
        kpi('Energy consumption', S('PUMP_MWH'), 'MWh', 2, ['Last shift', 'none']),
        kpi('Specific energy', S('PUMP_SEC'), 'kWh/t', 1, againstTarget(S('PUMP_SEC'), 6.5)),
        kpi('Availability', S('PUMP_AVAIL'), '%', 1, availStatus(S('PUMP_AVAIL'))),
      ];

    case 'compressor':
      return [
        kpi('Energy consumption', S('COMP_MWH'), 'MWh', 2, ['Last shift', 'none']),
        kpi('Specific energy', S('COMP_SEC'), 'kWh/t', 1, againstTarget(S('COMP_SEC'), 9.0)),
        kpi('Availability', S('COMP_AVAIL'), '%', 1, availStatus(S('COMP_AVAIL'))),
      ];

    default:
      return null;
  }
}
