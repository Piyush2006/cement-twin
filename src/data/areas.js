/**
 * Plant areas as annotated on the reference dashboard.
 *
 * IMPORTANT — these anchors are PLACED, not derived. The GLB names only the
 * preheater, the clinker silo and 14 cement silos; it has no geometry called
 * "Raw Mill" or "Coal Mill", so there is nothing to measure these from. Each
 * `anchor` below is a best-fit position read off a plan view of the model and
 * matched to the reference image's leader lines.
 *
 * Each anchor sits on a structure that is really there — they were placed from a
 * height map of the model's footprint, not guessed. What remains inferred is
 * WHICH structure is which: the process order of a dry-process line was used to
 * assign names, and that assignment is worth checking against the real plant.
 *
 * The `y` here is only a starting value: on load every anchor is raycast straight
 * down onto the model and snapped to the surface, so a marker can never float.
 * If an anchor's x/z sits over empty ground the viewer searches outward for the
 * nearest geometry and logs the corrected position to the console.
 *
 * To re-place one: click anywhere on the model and the clicked world position is
 * logged as `[x, y, z]`. Paste it in as that area's `anchor`.
 *
 * Annotations are name-only. `tags` and `costMtd` are kept because the simulator
 * already computes them and a richer card may be wanted later; nothing reads
 * them today.
 */

export const AREAS = [
  {
    id: 'ls-crusher', no: '01', name: 'LS Crusher',
    anchor: [-5.10, -1.80, -6.20], tone: 'auto', costMtd: 0.93,
    tags: ['CRU_TPH'],
  },
  {
    id: 'raw-mill', no: '02', name: 'Raw Mill',
    anchor: [0.10, -0.50, -6.10], tone: 'auto', costMtd: 0,
    tags: ['RM_TPH', 'preheater:PH_FEED'],
  },
  {
    id: 'ball-mill', no: '03', name: 'Ball Mill',
    anchor: [4.10, -1.00, -6.20], tone: 'auto', costMtd: 0,
    tags: ['RM_TPH', 'SPEC_POWER'],
  },
  {
    id: 'kiln', no: '04', name: 'Kiln',
    anchor: [6.30, -1.50, -1.70], tone: 'auto', costMtd: 0,
    tags: [
      'preheater:PH_CALC_T', 'preheater:PH_KILN_IN_T', 'preheater:PH_DRAFT',
      'preheater:PH_O2', 'preheater:PH_CO', 'preheater:PH_SHC',
      'preheater:PH_CALC_DEG', 'KILN_SPEED', 'KILN_TORQUE',
      'STACK_DUST', 'STACK_NOX', 'STACK_SO2',
    ],
  },
  {
    id: 'coal-mill', no: '05', name: 'Coal Mill',
    anchor: [2.90, -1.00, -2.90], tone: 'auto', costMtd: 0,
    tags: ['preheater:PH_TSR'],
  },
  {
    id: 'cement-mill', no: '06', name: 'Cement Mill',
    anchor: [-4.50, -1.50, -1.60], tone: 'auto', costMtd: 0,
    tags: [
      'CM_TPH', 'COOL_EFF',
      'cement-silo-1:CEM_BLAINE', 'cement-silo-1:CEM_R45', 'cement-silo-1:CEM_SO3',
      'cement-silo-4:CEM_BLAINE', 'cement-silo-4:CEM_R45',
    ],
  },
  {
    id: 'slag-mill', no: '07', name: 'Slag Mill',
    anchor: [-6.50, -0.80, 5.20], tone: 'auto', costMtd: 3.93,
    tags: ['cement-silo-2:CEM_BLAINE', 'cement-silo-2:CEM_TEMP'],
  },
  {
    id: 'packaging', no: '08', name: 'Packaging Plant',
    anchor: [5.89, -2.00, 3.30], tone: 'neutral', costMtd: 0,
    tags: [],
  },
  {
    id: 'pump-house', no: '09', name: 'Utilities - Pump House',
    anchor: [8.90, -1.60, -0.90], tone: 'neutral', costMtd: 0,
    tags: [],
  },
  {
    id: 'compressor', no: '10', name: 'Utilities - Compressor',
    anchor: [9.20, -1.60, -5.00], tone: 'neutral', costMtd: 0,
    tags: [],
  },
];

import { RCA } from './rca.js';

/** Areas, with the BRUCE issue count folded in where findings exist. */
export const ALL_AREAS = AREAS.map((a) => (RCA[a.id] ? { ...a, rca: RCA[a.id].issueCount } : a));
