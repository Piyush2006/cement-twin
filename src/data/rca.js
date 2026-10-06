/**
 * BRUCE root-cause findings.
 *
 * SIMULATED, like everything else in this build: BRUCE is not analysing the
 * plant here. These are fixed, realistic findings for a dry-process line, shaped
 * exactly as the contextual-AI layer would return them, so the panel can be
 * wired to a real Bruce AI endpoint by replacing this module.
 *
 * An area with no entry simply shows no RCA row on its card.
 */

export const RCA = {
  kiln: {
    issueCount: 5,
    severity: 'critical',
    title: 'Poor Combustion in Kiln',
    detectedAt: '10:42 AM, 01 Oct 2026',
    confidence: 86,
    rootCause: {
      name: 'Inconsistent Fuel-Air Ratio',
      detail: 'Imbalance between fuel flow and combustion air leading to incomplete combustion.',
    },
    evidence: [
      { icon: 'temp', text: 'Kiln temperature decreased by 7%' },
      { icon: 'fuel', text: 'Fuel consumption increased by 13%' },
      { icon: 'o2', text: 'O₂ level increased by 4.2%' },
      { icon: 'draft', text: 'Draft pressure is fluctuating' },
      { icon: 'history', text: 'Pattern similar to 3 previous events' },
    ],
    chain: [
      { label: 'Fuel Flow ↑', tone: 'warm' },
      { label: 'Air Flow ↓', tone: 'cool' },
      { label: 'Combustion Imbalance', tone: 'amber' },
      { label: 'Poor Combustion', tone: 'warm' },
    ],
    alternatives: [
      { name: 'Burner Issue', pct: 32 },
      { name: 'ID Fan Issue', pct: 21 },
      { name: 'Raw Material Change', pct: 16 },
    ],
    actions: [
      'Check burner condition and fuel nozzles',
      'Verify fuel flow and combustion air control',
      'Inspect ID fan and draft system',
      'Review raw material quality',
    ],
    parameters: [
      { tag: 'preheater:PH_KILN_IN_T', label: 'Kiln inlet gas temp', weight: 'primary' },
      { tag: 'preheater:PH_O2', label: 'Preheater outlet O₂', weight: 'primary' },
      { tag: 'preheater:PH_CO', label: 'Preheater outlet CO', weight: 'primary' },
      { tag: 'preheater:PH_DRAFT', label: 'Preheater fan draft', weight: 'supporting' },
      { tag: 'preheater:PH_SHC', label: 'Specific heat consumption', weight: 'supporting' },
      { tag: 'KILN_TORQUE', label: 'Kiln drive torque', weight: 'supporting' },
    ],
    analysis: [
      { step: 'Detection', text: 'Combustion efficiency drifted outside its control band for 42 minutes across three consecutive readings.' },
      { step: 'Correlation', text: 'Fuel flow rose while secondary air stayed flat; O₂ and CO moved together, which rules out a sensor fault on either one.' },
      { step: 'Elimination', text: 'Raw-meal feed and kiln speed held steady throughout, so a feed-side disturbance does not explain the signature.' },
      { step: 'Match', text: 'The pattern matches three prior events on this line, each resolved by burner nozzle cleaning and air-damper re-trim.' },
    ],
  },

  'raw-mill': {
    issueCount: 2,
    severity: 'warning',
    title: 'Mill Differential Pressure Rising',
    detectedAt: '08:15 AM, 01 Oct 2026',
    confidence: 71,
    rootCause: {
      name: 'Grinding Bed Instability',
      detail: 'Mill differential pressure is climbing while output holds, consistent with an unstable grinding bed.',
    },
    evidence: [
      { icon: 'draft', text: 'Mill ΔP up 9% over 6 hours' },
      { icon: 'fuel', text: 'Specific power up 4%' },
      { icon: 'history', text: 'Water spray duty cycling more often' },
    ],
    chain: [
      { label: 'Feed Moisture ↑', tone: 'cool' },
      { label: 'Bed Instability', tone: 'amber' },
      { label: 'Rising ΔP', tone: 'warm' },
    ],
    alternatives: [
      { name: 'Worn Grinding Table', pct: 28 },
      { name: 'Classifier Setting', pct: 19 },
    ],
    actions: [
      'Check feed moisture and dryer duty',
      'Review water injection set point',
      'Inspect grinding table and roller wear',
    ],
    parameters: [
      { tag: 'RM_TPH', label: 'Raw mill feed', weight: 'primary' },
      { tag: 'SPEC_POWER', label: 'Specific power', weight: 'supporting' },
    ],
    analysis: [
      { step: 'Detection', text: 'Differential pressure crossed its upper warning limit while throughput stayed on target.' },
      { step: 'Correlation', text: 'Specific power rose with ΔP, pointing at the grinding bed rather than the fan.' },
      { step: 'Elimination', text: 'Fan speed and damper position were unchanged, so draught is not the driver.' },
    ],
  },
};

export const hasRca = (areaId) => Boolean(RCA[areaId]);

/**
 * The compact Bruce Insight card from the demo: root cause, actions each with
 * their own downtime and OEE gain, and the shift value of fixing it. Money
 * figures are illustrative — there is no cost feed in this build.
 */
export const INSIGHT = {
  kiln: {
    oeeImpact: '\u221211 OEE',
    // Stated as a hypothesis, with the evidence it would need — the model cannot
    // confirm a cause, only point at what the trends are consistent with.
    cause: 'Fuel-air ratio instability and draft variation are affecting burning-zone stability',
    evidenceNeeded: 'the available fuel, O\u2082/CO and draft trends',
    rootCause: 'Inconsistent fuel-air ratio is dragging burning-zone stability. Draft trace plus rising CO matches a burner-fouling pattern flagged in the maintenance MTBF curve.',
    actions: [
      { text: 'Check burner/fuel-air balance', detail: '~55 min downtime \u00b7 +4.1 OEE pts' },
      { text: 'Check draft stability', detail: 'no stop \u00b7 +2.6 OEE pts' },
      { text: 'Inspect the hot-spot area/refractory condition', detail: '~30 min downtime \u00b7 +1.8 OEE pts' },
    ],
    impact: '~\u20b962K/shift recovered',
  },
  'raw-mill': {
    oeeImpact: '\u221218 OEE',
    cause: 'Grinding bed instability from high feed moisture is holding throughput below rate',
    evidenceNeeded: 'the mill \u0394P, feed moisture and water-spray trends',
    rootCause: 'Grinding bed instability from high feed moisture. Mill \u0394P is climbing while throughput holds, and water-spray duty is cycling more often than the recipe allows.',
    actions: [
      { text: 'Raise dryer duty and verify feed moisture', detail: 'no stop \u00b7 +5.4 OEE pts' },
      { text: 'Re-tune water injection set point', detail: 'no stop \u00b7 +3.2 OEE pts' },
      { text: 'Inspect table and roller wear profile', detail: '~90 min downtime \u00b7 +6.0 OEE pts' },
    ],
    impact: '~\u20b948K/shift recovered',
  },
  'cement-mill': {
    oeeImpact: '\u22127 OEE',
    cause: 'Separator reject load is running high for the target Blaine',
    evidenceNeeded: 'the separator speed, Blaine and recirculation trends',
    rootCause: 'Separator reject load is running high for the target Blaine, pushing recirculation and holding mill output below rate.',
    actions: [
      { text: 'Lower separator speed to the Blaine target', detail: 'no stop \u00b7 +2.9 OEE pts' },
      { text: 'Check diaphragm slot blinding', detail: '~70 min downtime \u00b7 +3.4 OEE pts' },
    ],
    impact: '~\u20b926K/shift recovered',
  },
};
