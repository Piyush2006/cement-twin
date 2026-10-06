/**
 * Per-area equipment tags.
 *
 * The plant-level model in `process.js` covers the process line; this adds the
 * local instrumentation an operator would actually see on an area faceplate, so
 * each annotation's warning/critical counts mean something instead of sitting at
 * zero. Same shape as the process tags: limits are [loLo, lo, hi, hiHi], null
 * disables that limit.
 */

const t = (code, name, unit, base, swing, limits, decimals = 1) =>
  ({ code, name, unit, base, swing, limits, decimals });

export const EQUIPMENT_TAGS = {
  'ls-crusher': [
    t('FEED', 'Crusher feed rate', 't/h', 820, 60, [420, 520, null, null], 0),
    t('MOTOR_I', 'Main motor current', 'A', 286, 22, [null, null, 340, 375], 0),
    t('BRG_DE', 'Bearing temp DE', '°C', 62, 6, [null, null, 80, 92], 1),
    t('BRG_NDE', 'Bearing temp NDE', '°C', 59, 6, [null, null, 80, 92], 1),
    t('VIB', 'Hammer shaft vibration', 'mm/s', 4.1, 1.1, [null, null, 7.1, 11.2], 2),
    t('GAP', 'Hammer-to-grate gap', 'mm', 38, 5, [20, 26, 52, 60], 0),
    t('DUST', 'Dedusting outlet', 'mg/Nm³', 18, 6, [null, null, 30, 50], 1),
    t('APRON_I', 'Apron feeder current', 'A', 74, 9, [null, null, 95, 110], 0),
  ],

  'raw-mill': [
    t('FEED', 'Mill feed rate', 't/h', 335, 18, [260, 290, null, null], 1),
    t('DP', 'Mill differential pressure', 'mbar', 61, 7, [null, null, 78, 90], 0),
    t('MOTOR_I', 'Mill motor current', 'A', 412, 26, [null, null, 480, 520], 0),
    t('OUT_T', 'Mill outlet temp', '°C', 92, 7, [70, 78, 105, 118], 1),
    t('VIB', 'Mill vibration', 'mm/s', 3.4, 0.9, [null, null, 6.3, 9.0], 2),
    t('BRG_DE', 'Bearing temp DE', '°C', 58, 6, [null, null, 78, 90], 1),
    t('BRG_NDE', 'Bearing temp NDE', '°C', 56, 6, [null, null, 78, 90], 1),
    t('R90', 'Residue 90 µm', '%', 14.2, 2.1, [null, null, 19, 23], 1),
    t('SPRAY', 'Water injection', 'l/h', 920, 180, [null, null, 1500, 1800], 0),
    t('FAN_I', 'Mill fan current', 'A', 198, 18, [null, null, 245, 270], 0),
    t('SEP_RPM', 'Separator speed', 'rpm', 78, 7, [48, 56, 96, 108], 0),
    t('GRIT', 'Grit recirculation', 't/h', 142, 22, [null, null, 205, 240], 0),
  ],

  'ball-mill': [
    t('FEED', 'Mill feed rate', 't/h', 178, 12, [130, 148, null, null], 1),
    t('MOTOR_I', 'Mill motor current', 'A', 386, 24, [null, null, 450, 490], 0),
    t('BRG_DE', 'Trunnion bearing DE', '°C', 54, 6, [null, null, 72, 84], 1),
    t('BRG_NDE', 'Trunnion bearing NDE', '°C', 52, 6, [null, null, 72, 84], 1),
    t('SOUND', 'Mill sound level', 'dB', 82, 5, [66, 72, 94, 101], 0),
    t('OUT_T', 'Mill outlet temp', '°C', 104, 8, [null, null, 118, 130], 1),
    t('VIB', 'Pinion vibration', 'mm/s', 3.1, 0.9, [null, null, 6.0, 8.6], 2),
    t('LUB_P', 'Lube oil pressure', 'bar', 2.6, 0.3, [1.4, 1.8, null, null], 2),
  ],

  kiln: [
    t('SHELL_T', 'Shell temperature, max', '°C', 268, 26, [null, null, 345, 395], 0),
    t('BZ_T', 'Burning zone temp', '°C', 1452, 38, [1330, 1380, 1510, 1560], 0),
    t('TORQUE', 'Kiln drive torque', '%', 68, 7, [null, null, 88, 95], 0),
    t('SPEED', 'Kiln speed', 'rpm', 3.42, 0.14, [2.6, 2.9, 4.1, 4.4], 2),
    t('INLET_T', 'Kiln inlet temp', '°C', 1048, 22, [980, 1010, 1085, 1110], 0),
    t('O2', 'Kiln inlet O₂', '%', 3.1, 0.3, [1.6, 2.1, 4.2, 4.9], 2),
    t('CO', 'Kiln inlet CO', 'ppm', 165, 60, [null, null, 600, 900], 0),
    t('COOLER_P', 'Cooler undergrate pressure', 'mbar', 42, 5, [null, null, 58, 68], 0),
    t('SEC_AIR_T', 'Secondary air temp', '°C', 965, 42, [820, 880, null, null], 0),
    t('TYRE_SLIP', 'Tyre slip, inlet', 'mm', 7.2, 1.4, [null, null, 11, 14], 1),
    // Shell pyrometer zones along the kiln. Hot spots are counted from these,
    // and refractory health is derived from them — neither is invented.
    t('SHELL_Z1', 'Shell temp, zone 1 (inlet)', '°C', 232, 14, [null, null, 330, 380], 0),
    t('SHELL_Z2', 'Shell temp, zone 2', '°C', 258, 16, [null, null, 330, 380], 0),
    t('SHELL_Z3', 'Shell temp, zone 3 (burning)', '°C', 318, 22, [null, null, 330, 380], 0),
    t('SHELL_Z4', 'Shell temp, zone 4 (burning)', '°C', 324, 24, [null, null, 330, 380], 0),
    t('SHELL_Z5', 'Shell temp, zone 5', '°C', 271, 17, [null, null, 330, 380], 0),
    t('SHELL_Z6', 'Shell temp, zone 6 (outlet)', '°C', 244, 13, [null, null, 330, 380], 0),
    t('FUEL', 'Fuel flow', 't/h', 14.2, 1.1, [null, null, 17.5, 19.5], 2),
    t('NOX', 'Stack NOx', 'mg/Nm³', 452, 60, [null, null, 600, 720], 0),
  ],

  'coal-mill': [
    t('FEED', 'Coal feed rate', 't/h', 22.4, 2.2, [14, 17, null, null], 2),
    t('OUT_T', 'Mill outlet temp', '°C', 78, 6, [58, 65, 92, 100], 1),
    t('O2_INERT', 'Inertisation O₂', '%', 9.2, 1.1, [null, null, 12, 14], 1),
    t('CO', 'Mill CO', 'ppm', 48, 22, [null, null, 250, 500], 0),
    t('DP', 'Mill differential pressure', 'mbar', 44, 6, [null, null, 62, 74], 0),
    t('BAG_DP', 'Bag filter ΔP', 'mbar', 14.2, 2.4, [null, null, 22, 28], 1),
    t('MOTOR_I', 'Mill motor current', 'A', 118, 12, [null, null, 150, 170], 0),
    t('FINE', 'Residue 90 µm', '%', 12.4, 1.8, [null, null, 18, 22], 1),
  ],

  'cement-mill': [
    t('FEED', 'Mill feed rate', 't/h', 178, 12, [140, 155, null, null], 1),
    t('MOTOR_I', 'Mill motor current', 'A', 402, 26, [null, null, 470, 510], 0),
    t('OUT_T', 'Mill outlet temp', '°C', 108, 8, [null, null, 122, 134], 1),
    t('BLAINE', 'Blaine fineness', 'cm²/g', 3340, 85, [2900, 3050, 3650, 3800], 0),
    t('SEP_RPM', 'Separator speed', 'rpm', 112, 9, [72, 84, 136, 150], 0),
    t('BRG_DE', 'Trunnion bearing DE', '°C', 56, 6, [null, null, 74, 86], 1),
    t('VIB', 'Pinion vibration', 'mm/s', 3.0, 0.9, [null, null, 6.0, 8.6], 2),
    t('REJECT', 'Separator reject', 't/h', 268, 32, [null, null, 360, 410], 0),
    t('GYPSUM', 'Gypsum dosing', '%', 4.6, 0.5, [3.2, 3.7, 5.6, 6.2], 2),
    t('LUB_P', 'Lube oil pressure', 'bar', 2.7, 0.3, [1.4, 1.8, null, null], 2),
  ],

  'slag-mill': [
    t('FEED', 'Slag feed rate', 't/h', 96, 11, [58, 68, null, null], 1),
    t('MOIST', 'Feed moisture', '%', 8.4, 1.3, [null, null, 12, 15], 1),
    t('OUT_T', 'Mill outlet temp', '°C', 96, 8, [null, null, 115, 128], 1),
    t('MOTOR_I', 'Mill motor current', 'A', 244, 20, [null, null, 300, 330], 0),
    t('DP', 'Mill differential pressure', 'mbar', 52, 6, [null, null, 70, 82], 0),
    t('BLAINE', 'Blaine fineness', 'cm²/g', 4150, 110, [3600, 3800, 4600, 4850], 0),
  ],
};

/**
 * Per-area OEE profile.
 *
 * Availability × Performance × Quality, the headline each annotation carries, as
 * in the Bruce demo. Bases differ per area so the plant shows a real spread
 * rather than ten identical greens: the raw mill is the problem child, the
 * cement mill is middling, the rest run well.
 */
export const AREA_OEE = {
  'ls-crusher': { a: 92.0, p: 88.0, q: 99.2, rated: 900, unit: 't/h', product: 'Limestone' },
  'raw-mill': { a: 71.0, p: 62.0, q: 97.8, rated: 360, unit: 't/h', product: 'Raw Meal' },
  'ball-mill': { a: 90.0, p: 86.0, q: 98.9, rated: 200, unit: 't/h', product: 'Clinker' },
  'kiln': { a: 93.0, p: 91.0, q: 98.4, rated: 150, unit: 't/h', product: 'Clinker' },
  'coal-mill': { a: 95.0, p: 92.0, q: 99.1, rated: 26, unit: 't/h', product: 'Pet Coke' },
  'cement-mill': { a: 88.0, p: 84.0, q: 98.6, rated: 195, unit: 't/h', product: 'OPC 53' },
  'slag-mill': { a: 94.0, p: 90.0, q: 99.0, rated: 110, unit: 't/h', product: 'PSC' },
};

/** OEE bands used for badge and metric colour. */
export const OEE_BAND = (oee) => (oee >= 85 ? 'good' : oee >= 60 ? 'warn' : 'crit');

/**
 * A, P and Q are banded separately — a 94 % quality figure is healthy while a
 * 94 % availability is not, so one shared threshold would mislead on both.
 */
export const METRIC_BAND = {
  a: (v) => (v >= 85 ? 'good' : v >= 70 ? 'warn' : 'crit'),
  p: (v) => (v >= 75 ? 'good' : v >= 60 ? 'warn' : 'crit'),
  q: (v) => (v >= 93 ? 'good' : v >= 88 ? 'warn' : 'crit'),
};
