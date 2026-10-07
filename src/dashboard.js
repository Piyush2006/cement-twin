/**
 * Kiln operator dashboard.
 *
 * A full-screen faceplate over the twin, opened from an area card. Every value
 * is read from the simulator on a 1 s tick, so the bars and gauges move; the
 * layout is fixed and only the numbers are re-rendered, which keeps a dense
 * screen cheap to update.
 */

import { RAW_MIX, SECTIONS, QUALITY_CONTEXT, INDICATORS, SCHEMATIC, REGIONS } from './data/kiln-dashboard.js';
import { SIM_HOURS_PER_TICK } from './data/process.js';

const ICONS = {
  tower: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V8l6-4 6 4v13M9 21v-6h6v6"/></svg>',
  fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 10V4a4 4 0 0 1 0 8M14 12h6a4 4 0 0 1-8 0M10 12H4a4 4 0 0 1 8 0"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s5 5 5 9a5 5 0 0 1-10 0c0-4 5-9 5-9z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c0-8 6-14 16-14 0 10-6 14-16 14zM4 20c3-4 6-6 10-7"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-7M15 8h5v5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
};

export class KilnDashboard {
  constructor(root, { sim, onClose }) {
    this.sim = sim;
    this.onClose = onClose;
    this.el = document.createElement('div');
    this.el.className = 'dash';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-dash-close]')) this.close();
      const t = e.target.closest('[data-dash-tab]');
      if (t) { this.tab = t.dataset.dashTab; this.#shell(); this.update(); return; }
      const r = e.target.closest('[data-region]');
      if (r) this.selectRegion(r.dataset.region);
    });
    this.tab = 'dashboard';
    this.region = null;
  }

  /** Highlight one piece of equipment, and bring its card into view. */
  selectRegion(id) {
    this.region = this.region === id ? null : id;
    this.#shell();
    this.update();
    if (!this.region) return;
    const r = REGIONS.find((x) => x.id === this.region);
    const card = [...this.el.querySelectorAll('.card')].find((c) =>
      c.querySelector('.card__h b')?.textContent.startsWith(`${r.section} \u00b7 `));
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.remove('is-flash');
      void card.offsetWidth;
      card.classList.add('is-flash');
    }
  }

  open() {
    this.el.hidden = false;
    document.body.classList.add('has-dash');
    this.#shell();
    this.update();
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove('has-dash');
    this.onClose?.();
  }

  get isOpen() { return !this.el.hidden; }

  /** Layout, drawn once; `update()` only writes the numbers back in. */
  #shell() {
    const now = new Date();
    this.el.innerHTML = `
      <header class="dash__top">
        <span class="dash__clock">
          <b data-clock>${now.toLocaleTimeString('en-GB')}</b>
          <i>${now.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</i>
        </span>
        <button class="dash__close" type="button" data-dash-close aria-label="Close dashboard">${ICONS.gear}</button>
      </header>

      <div class="dash__rawmix">
        <span class="dash__rawmix-label">Raw Mix Quality</span>
        <div class="dash__rawmix-row">
          ${RAW_MIX.map((r) => `<span class="rm">
            <i>${r.label}</i><b data-v="kd:${r.code}" data-d="${r.decimals}">—</b><u>${r.age}</u>
          </span>`).join('')}
        </div>
      </div>

      <nav class="dash__tabs">
        <button class="dash__tab" type="button" data-dash-tab="dashboard" aria-selected="${this.tab === 'dashboard'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Dashboard
        </button>
        <button class="dash__tab" type="button" data-dash-tab="trends" aria-selected="${this.tab === 'trends'}">
          ${ICONS.trend} Trend Charts
        </button>
      </nav>

      <div class="dash__grid">${this.tab === 'trends' ? this.#trends() : this.#main()}</div>`;
  }

  #main() {
    const left = SECTIONS.slice(0, 3);
    const mid = SECTIONS.slice(3);
    return `
      <div class="dash__col">${left.map((s) => this.#section(s)).join('')}</div>
      <div class="dash__col">
        ${mid.map((s) => this.#section(s)).join('')}
        <section class="card">
          <header class="card__h">${ICONS.gear}<b>Quality Context</b><span class="card__age">20 sec ago</span></header>
          <ul class="qc">
            ${QUALITY_CONTEXT.map((q) => `<li>
              <span>${q.label}</span>
              <b data-v="kd:${q.code}" data-d="${q.decimals}">—</b>
              <i data-flag="kd:${q.code}" data-lo="${q.lo}" data-hi="${q.hi}">—</i>
            </li>`).join('')}
          </ul>
        </section>
      </div>
      <div class="dash__col">
        <section class="card">
          <header class="card__h"><b>Performance Indicators</b><span class="card__age">20 sec ago</span></header>
          <div class="gauges">${INDICATORS.map((g) => this.#gauge(g)).join('')}</div>
        </section>
        <section class="card card--grow">
          <header class="card__h"><b>Plant Overview</b></header>
          ${this.#schematic()}
          <p class="card__hint">Live pyro-line readings</p>
        </section>
      </div>`;
  }

  #section(s) {
    return `
      <section class="card">
        <header class="card__h">${ICONS[s.icon] ?? ICONS.gear}<b>${s.no} · ${s.name}</b><span class="card__age">20 sec ago</span></header>
        ${s.metrics.map((met) => `
          <div class="met">
            <span class="met__name">${ICONS.trend}${met.label}</span>
            <div class="met__row">
              <span class="met__val"><b data-v="kd:${met.code}" data-d="${met.decimals}">—</b><u>${met.unit}</u></span>
              ${met.chips.length ? `<span class="met__chips">${met.chips.map((c) => `
                <span><i>${c.label}:</i><b data-v="kd:${c.code}" data-d="${c.decimals}">—</b> ${c.unit}</span>`).join('')}</span>` : ''}
              <span class="met__delta" data-delta="kd:${met.code}" data-sp="${met.sp}" data-d="${met.decimals}">—</span>
            </div>
            <div class="bar">
              <span class="bar__track"><span class="bar__fill"></span>
                <span class="bar__sp" style="left:${((met.sp - met.lsl) / (met.usl - met.lsl)) * 100}%"></span>
                <span class="bar__dot" data-dot="kd:${met.code}" data-lsl="${met.lsl}" data-usl="${met.usl}"></span>
              </span>
              <span class="bar__labels">
                <i>LSL: ${met.lsl}</i><i class="bar__spl">SP: ${met.sp}</i><i>USL: ${met.usl}</i>
              </span>
            </div>
          </div>`).join('')}
      </section>`;
  }

  #gauge(g) {
    return `
      <div class="gauge">
        <span class="gauge__name">${g.label}</span>
        <svg viewBox="0 0 120 70" class="gauge__svg">
          <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="#e6e9ef" stroke-width="9" stroke-linecap="round"/>
          <path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="#1a9f4b" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="145" stroke-dashoffset="48" data-arc="kd:${g.code}"/>
          <line x1="60" y1="62" x2="60" y2="26" stroke="#e8a33f" stroke-width="3" stroke-linecap="round"
            data-needle="kd:${g.code}" data-min="${g.min}" data-max="${g.max}" transform="rotate(0 60 62)"/>
          <circle cx="60" cy="62" r="3.5" fill="#8a93a5"/>
          <text x="14" y="69" class="gauge__tick">${g.min}</text>
          <text x="106" y="69" class="gauge__tick" text-anchor="end">${g.max}</text>
        </svg>
        <span class="gauge__val"><b data-v="kd:${g.code}" data-d="${g.decimals}">—</b> ${g.unit}</span>
        <span class="gauge__delta" data-delta="kd:${g.code}" data-sp="${g.target}" data-d="${g.decimals}">—</span>
        <span class="gauge__target">Target: ${g.target} ${g.unit}</span>
      </div>`;
  }

  /**
   * The pyro-line illustration with live readings pinned to its features and
   * its equipment made selectable. Regions are traced polygons over the image,
   * so the hit area and the highlight follow the drawing rather than a box.
   */
  #schematic() {
    const poly = (r) => r.points.map(([x, y]) => `${x},${y}`).join(' ');
    return `
      <div class="schem" data-selected="${this.region ?? ''}">
        <img class="schem__img" src="${import.meta.env.BASE_URL}kiln.png"
          alt="Preheater tower, calciner riser and rotary kiln" />
        <svg class="schem__hit" viewBox="0 0 100 100" preserveAspectRatio="none">
          ${REGIONS.map((r) => `<polygon class="schem__region" points="${poly(r)}"
            data-region="${r.id}" tabindex="0" role="button" aria-label="${r.label}"><title>${r.label}</title></polygon>`).join('')}
        </svg>
        ${REGIONS.map((r) => `<button class="schem__chip" type="button" data-region="${r.id}"
          style="left:${r.chip.x}%;top:${r.chip.y}%">${r.label}</button>`).join('')}
        ${SCHEMATIC.map((c) => `<span class="schem__tag" style="left:${c.x}%;top:${c.y}%">
          <i>${c.label}</i><b data-v="kd:${c.code}" data-d="2">\u2014</b> ${c.unit}</span>`).join('')}
      </div>
      <p class="card__hint">${this.region
        ? `Showing ${REGIONS.find((r) => r.id === this.region).label} \u2014 click again to clear`
        : 'Click a section to highlight it'}</p>`;
  }

  /** Everything the trend tab plots: the section metrics, then the two gauges. */
  #trendSeries() {
    return [
      ...SECTIONS.flatMap((sec) => sec.metrics.map((met) => ({
        code: met.code, label: met.label, unit: met.unit,
        lsl: met.lsl, usl: met.usl, decimals: met.decimals,
      }))),
      ...INDICATORS.map((g) => ({
        code: g.code, label: g.label, unit: g.unit,
        lsl: g.min, usl: g.max, decimals: g.decimals,
      })),
    ];
  }

  #trends() {
    const hours = Math.round(120 * SIM_HOURS_PER_TICK);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    const f = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="trend">
        <header class="trend__bar">
          <span class="trend__range">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            Time Range
          </span>
          <span class="trend__window">
            <i>Last ${hours} h</i>
            <b>${f(from)} \u2013 ${f(to)}</b>
          </span>
        </header>
        <div class="trend__grid">
          ${this.#trendSeries().map((t) => `
            <section class="card trend__card">
              <header class="card__h"><b class="trend__title">${t.label}</b></header>
              <div class="chart" data-chart="kd:${t.code}" data-lsl="${t.lsl}" data-usl="${t.usl}"
                data-unit="${t.unit}" data-d="${t.decimals}"></div>
              <span class="trend__legend"><i></i>${t.label}</span>
            </section>`).join('')}
        </div>
      </div>`;
  }

  /**
   * One trend chart.
   *
   * The spec band is drawn as a green field with dashed limits, and the trace is
   * split at every band crossing so the out-of-spec stretches are red — which is
   * the thing an operator is scanning for.
   */
  #drawChart(node) {
    const h = this.sim.history(node.dataset.chart);
    if (h.length < 2) return;
    const lsl = Number(node.dataset.lsl);
    const usl = Number(node.dataset.usl);
    const dec = Number(node.dataset.d ?? 2);
    const W = 620;
    const H = 160;
    const L = 46;
    const R = 76;
    const T = 10;
    const B = 26;

    const lo = Math.min(lsl, ...h);
    const hi = Math.max(usl, ...h);
    const pad = (hi - lo) * 0.12 || 1;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const X = (i) => L + (i / (h.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);

    // split into runs that are wholly inside or wholly outside the band
    const runs = [];
    let cur = null;
    h.forEach((v, i) => {
      const out = v > usl || v < lsl;
      if (!cur || cur.out !== out) {
        if (cur) cur.pts.push([X(i), Y(v)]);
        cur = { out, pts: [[X(i), Y(v)]] };
        runs.push(cur);
      } else cur.pts.push([X(i), Y(v)]);
    });

    const hoursBack = h.length * SIM_HOURS_PER_TICK;
    const ticks = [];
    for (let k = 0; k <= 6; k++) {
      const frac = k / 6;
      const d = new Date(Date.now() - (1 - frac) * hoursBack * 3600 * 1000);
      ticks.push({ x: L + frac * (W - L - R), t: `${String(d.getHours()).padStart(2, '0')}:00` });
    }

    node.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="chart__svg" preserveAspectRatio="none">
        <rect x="${L}" y="${Y(usl)}" width="${W - L - R}" height="${Math.max(0, Y(lsl) - Y(usl))}"
          fill="#d8f0df" opacity="0.75"/>
        <line x1="${L}" x2="${W - R}" y1="${Y(usl)}" y2="${Y(usl)}" stroke="#2f9e5a" stroke-width="1" stroke-dasharray="5 4"/>
        <line x1="${L}" x2="${W - R}" y1="${Y(lsl)}" y2="${Y(lsl)}" stroke="#2f9e5a" stroke-width="1" stroke-dasharray="5 4"/>
        <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#55607a" stroke-width="1"/>
        <line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c9ced9" stroke-width="1"/>
        ${[yMax, (yMax + yMin) / 2, yMin].map((v) => `
          <text x="${L - 6}" y="${Y(v) + 3}" class="chart__ytick" text-anchor="end">${v.toFixed(0)}</text>`).join('')}
        <text x="12" y="${H / 2}" class="chart__ylabel" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">${node.dataset.unit}</text>
        ${ticks.map((t) => `<text x="${t.x}" y="${H - 10}" class="chart__xtick" text-anchor="middle">${t.t}</text>`).join('')}
        ${runs.map((r) => `<polyline points="${r.pts.map((p) => p.join(',')).join(' ')}"
          fill="none" stroke="${r.out ? '#e23b3b' : '#f0a81c'}" stroke-width="1.4"
          stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('')}
        <text x="${W - R + 6}" y="${Y(usl) + 3}" class="chart__lim">USL: ${usl.toFixed(dec)}</text>
        <text x="${W - R + 6}" y="${Y(lsl) + 3}" class="chart__lim">LSL: ${lsl.toFixed(dec)}</text>
      </svg>`;
  }

  /** Write current values into the layout. Called once a second. */
  update() {
    if (this.el.hidden) return;
    const S = this.sim.state;
    const clock = this.el.querySelector('[data-clock]');
    if (clock) clock.textContent = new Date().toLocaleTimeString('en-GB');

    for (const n of this.el.querySelectorAll('[data-v]')) {
      const v = S[n.dataset.v];
      if (v != null) n.textContent = v.toFixed(Number(n.dataset.d ?? 2));
    }
    for (const n of this.el.querySelectorAll('[data-delta]')) {
      const v = S[n.dataset.delta];
      if (v == null) continue;
      const d = v - Number(n.dataset.sp);
      n.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(Number(n.dataset.d ?? 2))}`;
      n.dataset.sign = d >= 0 ? 'up' : 'down';
    }
    for (const n of this.el.querySelectorAll('[data-dot]')) {
      const v = S[n.dataset.dot];
      if (v == null) continue;
      const lsl = Number(n.dataset.lsl);
      const usl = Number(n.dataset.usl);
      n.style.left = `${Math.min(100, Math.max(0, ((v - lsl) / (usl - lsl)) * 100))}%`;
    }
    for (const n of this.el.querySelectorAll('[data-flag]')) {
      const v = S[n.dataset.flag];
      if (v == null) continue;
      const lo = Number(n.dataset.lo);
      const hi = Number(n.dataset.hi);
      const state = v < lo ? 'Low' : v > hi ? 'High' : 'OK';
      n.textContent = state;
      n.dataset.state = state.toLowerCase();
    }
    for (const n of this.el.querySelectorAll('[data-needle]')) {
      const v = S[n.dataset.needle];
      if (v == null) continue;
      const min = Number(n.dataset.min);
      const max = Number(n.dataset.max);
      const k = Math.min(1, Math.max(0, (v - min) / (max - min)));
      n.setAttribute('transform', `rotate(${-90 + k * 180} 60 62)`);
    }
    for (const n of this.el.querySelectorAll('[data-chart]')) this.#drawChart(n);
  }
}
