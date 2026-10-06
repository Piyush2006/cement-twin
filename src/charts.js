/**
 * Chart primitives.
 *
 * NOTE: with the twin running 3D-only, `fmt` is the only export in use — the
 * sparkline, level meter and status chip are kept for the detail panels, which
 * were removed from the layout rather than rewritten. Unused exports are tree-
 * shaken out of the bundle. Say the word and this trims to `fmt`.
 *
 * Every plot here is SINGLE-series, so it carries no legend — the tag name beside
 * it is the label. Colour roles come from the validated dark-mode palette in
 * styles.css (`--series-1`, `--status-*`). Status is never colour alone: it always
 * ships with a glyph and a word.
 */

const SERIES = 'var(--series-1)';
const STATUS_FILL = { good: 'var(--status-good)', warn: 'var(--status-warn)', crit: 'var(--status-crit)' };

export const STATUS_GLYPH = { good: '●', warn: '▲', crit: '■' };
export const STATUS_WORD = { good: 'Normal', warn: 'Warning', crit: 'Critical' };

/** Status chip: glyph + word + colour, so CVD readers never rely on hue. */
export function statusChip(sev) {
  return `<span class="sglyph sglyph--${sev}"><span class="sglyph__sym">${STATUS_GLYPH[sev]}</span>${STATUS_WORD[sev]}</span>`;
}

export function fmt(value, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Sparkline with optional limit bands. 2px stroke, recessive baseline, a single
 * end-point marker and a direct label — never a number on every point.
 *
 * @param {number[]} values
 * @param {{limits?:(number|null)[], severity?:string, code?:string}} opts
 */
export function sparkline(values, opts = {}) {
  const w = 300;
  const h = 34;
  const pad = 3;
  if (!values || values.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;

  const limits = opts.limits ?? [];
  const [loLo, lo, hi, hiHi] = limits;
  const candidates = [...values, ...limits.filter((v) => v != null)];
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);
  if (max - min < 1e-9) { max += 1; min -= 1; }
  const range = max - min;
  min -= range * 0.08;
  max += range * 0.08;

  const x = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);

  // limit bands sit behind the trace, low-alpha, so they read as context
  let bands = '';
  const band = (from, to, color) => {
    const y1 = Math.min(y(from), y(to));
    const y2 = Math.max(y(from), y(to));
    bands += `<rect x="0" y="${y1.toFixed(1)}" width="${w}" height="${Math.max(0.6, y2 - y1).toFixed(1)}" fill="${color}" opacity="0.1"/>`;
  };
  if (hiHi != null) band(hiHi, max, STATUS_FILL.crit);
  else if (hi != null) band(hi, max, STATUS_FILL.warn);
  if (hi != null && hiHi != null) band(hi, hiHi, STATUS_FILL.warn);
  if (loLo != null) band(min, loLo, STATUS_FILL.crit);
  else if (lo != null) band(min, lo, STATUS_FILL.warn);
  if (lo != null && loLo != null) band(loLo, lo, STATUS_FILL.warn);

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const stroke = opts.severity && opts.severity !== 'good' ? STATUS_FILL[opts.severity] : SERIES;

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img"
      aria-label="trend, last value ${fmt(last, 2)}" data-spark="${opts.code ?? ''}">
    ${bands}
    <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.6"
      fill="${stroke}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** Horizontal level meter for one silo cell. Label + value are always present. */
export function levelMeter({ name, level, grade, rate }) {
  const sev = level >= 94 || level <= 6 ? 'crit' : level >= 88 || level <= 12 ? 'warn' : 'good';
  const cls = sev === 'crit' ? ' meter__fill--crit' : sev === 'warn' ? ' meter__fill--warn' : '';
  const dir = rate > 0.5 ? '▲ filling' : rate < -0.5 ? '▼ drawing' : '— idle';
  return `<div class="meter" title="${name} · ${grade} · ${dir} ${fmt(Math.abs(rate), 0)} t/h">
    <span class="meter__name">${name}</span>
    <span class="meter__track"><span class="meter__fill${cls}" style="width:${level.toFixed(1)}%"></span></span>
    <span class="meter__val">${level.toFixed(0)}%</span>
  </div>`;
}

/**
 * Crosshair tooltip for the sparklines. One delegated listener for the whole
 * panel — an HTML chart should be inspectable, but 60 nodes of hover plumbing
 * is not worth it.
 */
export function attachSparkHover(scope, lookup) {
  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed', zIndex: '80', pointerEvents: 'none', opacity: '0',
    padding: '5px 8px', borderRadius: '4px', font: '600 11px/1.3 Inter, sans-serif',
    background: '#ffffff', color: '#19283a',
    border: '1px solid #c8cfd8', boxShadow: '0 2px 6px rgba(16,36,64,.07), 0 10px 26px rgba(16,36,64,.09)',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums', transition: 'opacity 100ms',
  });
  document.body.appendChild(tip);

  scope.addEventListener('pointermove', (e) => {
    const svg = e.target.closest('svg[data-spark]');
    if (!svg) { tip.style.opacity = '0'; return; }
    const code = svg.dataset.spark;
    const info = lookup(code);
    if (!info || !info.values?.length) { tip.style.opacity = '0'; return; }
    const r = svg.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(k * (info.values.length - 1));
    const ago = info.values.length - 1 - i;
    tip.innerHTML = `${fmt(info.values[i], info.decimals)} ${info.unit}`
      + `<span style="color:#64758d;font-weight:500"> · ${ago === 0 ? 'now' : `${ago} ticks ago`}</span>`;
    tip.style.opacity = '1';
    tip.style.left = `${Math.min(e.clientX + 12, innerWidth - 150)}px`;
    tip.style.top = `${e.clientY - 34}px`;
  });
  scope.addEventListener('pointerleave', () => { tip.style.opacity = '0'; });
}
