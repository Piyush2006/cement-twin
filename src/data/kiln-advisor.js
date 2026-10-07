/**
 * The kiln advisor — BRUCE's operator flow for the pyro line.
 *
 * The flow an operator actually walks: "how is the kiln running" → a status
 * board → "why is X high" → the contributors the data supports → "what should
 * we do" → the checks to run. Each step reads the simulator at the moment of
 * asking, so nothing here is a canned reply.
 *
 * Limits are taken from the faceplate's own configuration wherever it has one
 * (the SHC target, the Kiln Feed spec band, the C3S expected band) so the
 * advisor and the dashboard can never disagree about what "normal" means.
 */

import { INDICATORS, SECTIONS, QUALITY_CONTEXT } from './kiln-dashboard.js';

const ind = (code) => INDICATORS.find((i) => i.code === code);
const metric = (code) => SECTIONS.flatMap((s) => s.metrics).find((m) => m.code === code);
const quality = (code) => QUALITY_CONTEXT.find((q) => q.code === code);

/**
 * Kiln Inlet O2 is the one headline reading the faceplate carries without a
 * configured limit — it is drawn as a context chip, not a bar. The plant's
 * operating ceiling is declared here so the advisor judges it against a stated
 * number rather than an opinion.
 */
export const KILN_INLET_O2_MAX = 3.0;

/**
 * Heat-recovery references for the cooler air temperatures.
 *
 * The faceplate draws these as context chips with no spec band, so the advisor
 * needs a stated number to judge them against. Comparing each against its own
 * mean would be meaningless — a tag sits below its mean half the time by
 * construction — so the plant's heat-recovery targets are declared here and
 * shown to the operator next to the reading.
 */
export const AIR_TARGETS = { SAT: 950, TAT: 780 };

/** The four KPIs the status board leads with. */
export function headlineKpis(state) {
  const shc = ind('SHC_G');
  const feed = metric('KILN_FEED');
  const c3s = quality('C3S');
  return [
    max('SHC', state['kd:SHC_G'], 'kcal/kg', shc.target, 2),
    band('Kiln Feed', state['kd:KILN_FEED'], 'TPH', feed.lsl, feed.usl, 2),
    max('Kiln Inlet O₂', state['kd:KILN_IN_O2'], '%', KILN_INLET_O2_MAX, 2),
    band('C3S', state['kd:C3S'], '%', c3s.lo, c3s.hi, 2),
  ];
}

/** Secondary readings the board flags under the headline four. */
export function watchlist(state) {
  const calc = quality('CALC_PCT');
  return [
    minimum('Secondary Air', state['kd:SAT'], '°C', AIR_TARGETS.SAT, 1),
    minimum('Tertiary Air', state['kd:TAT'], '°C', AIR_TARGETS.TAT, 1),
    band('Calcination', state['kd:CALC_PCT'], '%', calc.lo, calc.hi, 2),
    plain('PH String 1 O₂', state['kd:PH1_O2'], '%', 2),
  ];
}

function max(label, value, unit, limit, decimals) {
  const status = value == null ? 'none' : value > limit ? 'high' : 'normal';
  return { label, value, unit, decimals, status, limit: `≤ ${fmt(limit, decimals)}` };
}

function band(label, value, unit, lo, hi, decimals) {
  const status = value == null ? 'none' : value < lo ? 'low' : value > hi ? 'high' : 'normal';
  return { label, value, unit, decimals, status, limit: `${fmt(lo, decimals)}–${fmt(hi, decimals)}` };
}

function minimum(label, value, unit, floor, decimals) {
  const status = value == null ? 'none' : value < floor ? 'low' : 'normal';
  return { label, value, unit, decimals, status, limit: `\u2265 ${fmt(floor, decimals)}` };
}

function plain(label, value, unit, decimals) {
  return { label, value, unit, decimals, status: 'none', limit: '' };
}

const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

/**
 * Why SHC is high.
 *
 * Two mechanisms can lift specific heat consumption on this line: the kiln is
 * recovering less heat (or demanding more), or it is carrying more air than it
 * needs. A contributor is only offered when the readings behind it are actually
 * out of band right now — BRUCE never asserts a cause the current data does not
 * show.
 */
export function shcContributors(state) {
  const calc = quality('CALC_PCT');
  const sat = state['kd:SAT'];
  const tat = state['kd:TAT'];
  const calcPct = state['kd:CALC_PCT'];
  const o2 = state['kd:KILN_IN_O2'];

  const heat = [];
  if (sat != null && sat < AIR_TARGETS.SAT) {
    heat.push(`secondary air at ${fmt(sat, 1)} °C, under the ${AIR_TARGETS.SAT} °C target`);
  }
  if (tat != null && tat < AIR_TARGETS.TAT) {
    heat.push(`tertiary air at ${fmt(tat, 1)} °C, under the ${AIR_TARGETS.TAT} °C target`);
  }
  if (calcPct != null && calcPct < calc.lo) heat.push(`calcination at ${fmt(calcPct)} %, below the ${fmt(calc.lo)} % band`);

  const air = [];
  if (o2 != null && o2 > KILN_INLET_O2_MAX) {
    air.push(`kiln inlet O₂ at ${fmt(o2)} %, above the ${fmt(KILN_INLET_O2_MAX)} % operating ceiling`);
  }

  const out = [];
  if (heat.length) {
    out.push({
      title: 'Lower heat recovery / higher heat demand',
      detail: heat.join('; ') + '.',
    });
  }
  if (air.length) {
    out.push({
      title: 'Higher excess-air indication',
      detail: air.join('; ') + '.',
    });
  }
  return out;
}

/** What to do about it — checks, in the order an operator would run them. */
export const SHC_ACTIONS = [
  'Check cooler heat-recovery performance against the plant target.',
  'Review kiln and preheater O₂ and draft trends against configured limits.',
  'Check calcination and combustion trends for increased heat demand.',
  'Compare the last 24 hours with a normal operating period to confirm the cause.',
];

/** The chain the advisor follows, shown so the reasoning is inspectable. */
export const SHC_CHAIN = [
  'SHC high',
  'check abnormal KPIs',
  'compare trends',
  'identify probable cause',
  'recommend action',
  'monitor SHC',
];

/**
 * Confidence is Medium by construction: the readings show WHICH parameters are
 * out of band, but not which moved first. Ordering needs history, so the advisor
 * says so instead of implying a root cause it cannot yet evidence.
 */
export const SHC_CONFIDENCE = {
  level: 'Medium',
  because: 'A time-series comparison is required to confirm which parameter changed first.',
};
