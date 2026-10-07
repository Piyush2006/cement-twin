/**
 * Bruce — the assistant surface.
 *
 * Collapsed it is a pill in the bottom-right: the mark, "Bruce AI", and a red
 * dot when something needs attention. Expanded it is the right-docked panel —
 * header, Recommendations / Insights tabs, content, and the ask box.
 *
 * Answers are COMPUTED from the live simulator, not scripted: the question is
 * matched to an intent and the reply is assembled from current OEE, alarm counts
 * and findings. It can therefore be wrong about the real plant — the telemetry is
 * simulated — but it is never wrong about what this page is showing.
 */

import { OEE_BAND } from './data/equipment.js';
import { INSIGHT, RCA } from './data/rca.js';

const pct = (v, d = 1) => `${v.toFixed(d)}%`;

/** Swap `public/bruce-logo.svg` to change the mark everywhere it appears. */
const LOGO = '<img class="bruce__logo" src="bruce-logo.svg" alt="" width="40" height="40" />';

export class Bruce {
  constructor(root, { sim, areas, onFocusArea }) {
    this.sim = sim;
    this.areas = areas;
    this.onFocusArea = onFocusArea;
    this.open = false;
    this.tab = 'insights';
    this.thread = [];

    this.el = document.createElement('div');
    this.el.className = 'bruce';
    this.el.innerHTML = `
      <button class="bruce__fab" type="button" aria-label="Ask Bruce AI" aria-expanded="false">
        ${LOGO}
        <span class="bruce__fabname">Bruce AI</span>
        <span class="bruce__dot" data-dot hidden aria-hidden="true"></span>
      </button>
      <aside class="bruce__panel" hidden aria-label="Bruce AI">
        <header class="bruce__top">
          ${LOGO}
          <span class="bruce__brandname">Bruce AI</span>
          <button class="bruce__icon" type="button" data-act="reset" aria-label="Start over">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/></svg>
          </button>
          <button class="bruce__icon" type="button" data-act="close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        <nav class="bruce__tabs" role="tablist">
          <button class="bruce__tab" type="button" role="tab" data-tab="recommendations" aria-selected="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            Recommendations
          </button>
          <button class="bruce__tab" type="button" role="tab" data-tab="insights" aria-selected="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
            Insights
          </button>
        </nav>
        <div class="bruce__body" id="bruce-body"></div>
        <form class="bruce__ask" autocomplete="off">
          <input class="bruce__input" type="text" name="q"
            placeholder="Ask Bruce anything about this plant" aria-label="Ask Bruce anything about this plant" />
          <button class="bruce__mic" type="button" data-act="voice" aria-label="Talk to Bruce">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          </button>
          <button class="bruce__send" type="submit" aria-label="Ask">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
          </button>
        </form>
        <div class="voice" hidden>
          <span class="orb" aria-hidden="true"><i></i><u></u></span>
          <span class="voice__status">Listening\u2026</span>
          <ul class="voice__steps"></ul>
          <div class="voice__controls">
            <button class="voice__btn" type="button" data-act="type" aria-label="Type instead">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
            </button>
            <button class="voice__btn voice__btn--mic" type="button" data-act="voice-stop" aria-label="Stop">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
            </button>
            <button class="voice__btn voice__btn--close" type="button" data-act="type" aria-label="Close voice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        </div>
      </aside>`;
    root.appendChild(this.el);

    this.fab = this.el.querySelector('.bruce__fab');
    this.panel = this.el.querySelector('.bruce__panel');
    this.bodyEl = this.el.querySelector('#bruce-body');
    this.input = this.el.querySelector('.bruce__input');
    this.dot = this.el.querySelector('[data-dot]');
    this.voice = this.el.querySelector('.voice');
    this.voiceStatus = this.el.querySelector('.voice__status');
    this.voiceSteps = this.el.querySelector('.voice__steps');

    this.fab.addEventListener('click', () => this.toggle(true));
    this.el.querySelector('.bruce__top').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.toggle(false);
      if (act === 'reset') { this.thread = []; this.#render(); }
    });
    this.el.querySelector('.bruce__tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { this.tab = t.dataset.tab; this.#render(); }
    });
    this.el.querySelector('.bruce__ask').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="voice"]')) { e.preventDefault(); this.#listen(); }
    });
    this.voice.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'type' || act === 'voice-stop') this.#endVoice();
    });
    this.el.querySelector('.bruce__ask').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (q) { this.input.value = ''; this.#ask(q); }
    });
    this.bodyEl.addEventListener('click', (e) => {
      const id = e.target.closest('[data-area]')?.dataset.area;
      if (id) this.onFocusArea?.(id);
    });

    this.#refreshBadge();
    setInterval(() => this.#refreshBadge(), 4000);
  }

  /** Ask on the user's behalf — the spec's one natural question, one click. */
  ask(question) {
    this.toggle(true);
    this.#ask(question);
  }

  toggle(open) {
    this.open = open;
    this.panel.hidden = !open;
    this.fab.hidden = open;
    this.fab.setAttribute('aria-expanded', String(open));
    this.el.classList.toggle('is-open', open);
    if (open) { this.#render(); this.input.focus(); }
  }

  /** Areas that carry an OEE, read fresh each call. */
  #scored() {
    return this.areas
      .map((a) => ({ area: a, oee: this.sim.oeeOfArea(a.id), counts: this.sim.countsOfArea(a.id) }))
      .filter((r) => r.oee);
  }

  #matchArea(q) {
    const lower = q.toLowerCase();
    return this.areas.find((a) => lower.includes(a.name.toLowerCase()))
      ?? this.areas.find((a) => lower.includes(a.id.replace(/-/g, ' ')))
      ?? this.areas.find((a) => a.name.split(/[ \u2013-]/).some((w) => w.length > 3 && lower.includes(w.toLowerCase())));
  }

  /**
   * Map the question to an intent and answer it from live state. Nothing here is
   * a canned reply — every number is read off the simulator at the moment of
   * asking.
   */
  #resolve(q) {
    const lower = q.toLowerCase();
    const rows = this.#scored();
    const area = this.#matchArea(q);
    const byOee = [...rows].sort((x, y) => x.oee.oee - y.oee.oee);
    const plantOee = rows.reduce((t, r) => t + r.oee.oee, 0) / (rows.length || 1);
    const alarms = this.areas
      .map((a) => ({ a, c: this.sim.countsOfArea(a.id) }))
      .filter((r) => r.c.warn || r.c.crit)
      .sort((x, y) => (y.c.crit - x.c.crit) || (y.c.warn - x.c.warn));

    // "How is my Kiln doing?" — one natural question, the whole assessment back.
    if (area && /how is|how's|hows|status of|assess|doing|health of|report on/.test(lower)) {
      const d = this.sim.assessArea(area.id);
      return {
        kind: 'assessment',
        area,
        data: d,
        insight: INSIGHT[area.id] ?? null,
        steps: [
          `reading ${this.sim.tagsOfArea(area.id).length} live tags for ${area.name}`,
          'scoring health, energy and condition',
          d.anomalies.length ? `isolating ${d.anomalies.length} tag${d.anomalies.length === 1 ? '' : 's'} outside limits` : 'no tag outside limits',
          INSIGHT[area.id] ? 'matching to a known finding' : 'no stored finding for this area',
        ],
      };
    }

    if (/why|root cause|rca|diagnos/.test(lower)) {
      const t = area ?? byOee[0]?.area;
      if (!t) return { steps: ['looking for instrumented areas'], answer: 'Nothing on this page is instrumented yet.' };
      const ins = INSIGHT[t.id];
      const steps = [
        `reading live tags for ${t.name}`,
        'comparing against limits and recent pattern',
        ins ? 'matching to known findings' : 'no stored finding for this area',
      ];
      if (!ins) {
        const c = this.sim.countsOfArea(t.id);
        return { steps, answer: `No BRUCE finding is open on ${t.name}. It currently shows ${c.warn} warning and ${c.crit} critical tag${c.crit === 1 ? '' : 's'}.`, chips: [t] };
      }
      return { steps, answer: `${t.name}: ${ins.rootCause} Acting on it is worth ${ins.impact} and about ${ins.oeeImpact.replace('\u2212', '')} of OEE.`, chips: [t] };
    }

    if (/worst|lowest|dragging|problem|underperform/.test(lower)) {
      const w = byOee[0];
      const ins = INSIGHT[w.area.id];
      return {
        steps: ['pulling OEE for all instrumented areas', 'ranking by OEE', 'isolating the lowest performer'],
        answer: `${w.area.name} is the worst performer at ${pct(w.oee.oee)} OEE \u2014 Availability ${pct(w.oee.a)}, Performance ${pct(w.oee.p)}, Quality ${pct(w.oee.q, 2)}. `
          + (ins ? `BRUCE attributes it to ${ins.rootCause.split('.')[0].toLowerCase()}.` : 'No root-cause finding is open on it.'),
        chips: [w.area],
      };
    }
    if (/best|highest|top perform/.test(lower)) {
      const t = byOee[byOee.length - 1];
      return {
        steps: ['pulling OEE for all instrumented areas', 'ranking by OEE'],
        answer: `${t.area.name} is running best at ${pct(t.oee.oee)} OEE (A ${pct(t.oee.a)} \u00b7 P ${pct(t.oee.p)} \u00b7 Q ${pct(t.oee.q, 2)}).`,
        chips: [t.area],
      };
    }

    if (/alarm|critical|warning|issue|fault/.test(lower)) {
      if (!alarms.length) {
        return { steps: ['scanning every area tag against its limits'], answer: 'No tag is outside its limits right now across the instrumented areas.' };
      }
      const list = alarms.map((r) => `${r.a.name} (${r.c.warn}W / ${r.c.crit}C)`).join(', ');
      const totW = alarms.reduce((t, r) => t + r.c.warn, 0);
      const totC = alarms.reduce((t, r) => t + r.c.crit, 0);
      return {
        steps: ['scanning every area tag against its limits', 'grouping breaches by area', 'ranking by severity'],
        answer: `${totW} warning and ${totC} critical tag${totC === 1 ? '' : 's'} are active, across: ${list}.`,
        chips: alarms.map((r) => r.a),
      };
    }

    if (area) {
      const r = rows.find((x) => x.area.id === area.id);
      const c = this.sim.countsOfArea(area.id);
      if (!r) {
        return { steps: [`looking up ${area.name}`], answer: `${area.name} carries no OEE instrumentation in this model \u2014 only its month-to-date maintenance cost (${area.costMtd} Lakhs).`, chips: [area] };
      }
      return {
        steps: [`reading ${area.name} tags`, 'computing A \u00d7 P \u00d7 Q'],
        answer: `${area.name} is at ${pct(r.oee.oee)} OEE (${OEE_BAND(r.oee.oee)} band) \u2014 A ${pct(r.oee.a)}, P ${pct(r.oee.p)}, Q ${pct(r.oee.q, 2)}. `
          + `Output ${r.oee.output.toFixed(0)} of ${r.oee.rated} ${r.oee.unit}, with ${c.warn} warning and ${c.crit} critical tag${c.crit === 1 ? '' : 's'}.`,
        chips: [area],
      };
    }

    const worst = byOee[0];
    return {
      steps: ['pulling OEE across the instrumented areas', 'averaging for the line', 'noting the weakest area'],
      answer: `Line OEE averages ${pct(plantOee)} across ${rows.length} instrumented areas. `
        + `${worst.area.name} is the laggard at ${pct(worst.oee.oee)}, and ${alarms.length} area${alarms.length === 1 ? '' : 's'} currently carry open alarms. `
        + `${Object.keys(RCA).length} area${Object.keys(RCA).length === 1 ? '' : 's'} have a BRUCE finding available.`,
      chips: [worst.area],
    };
  }

  /**
   * Voice mode — the demo's listening view. Uses the browser's SpeechRecognition
   * where it exists; where it does not, it says so rather than miming a feature
   * that is not there.
   */
  #listen() {
    const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    this.voice.hidden = false;
    this.voiceSteps.innerHTML = '';
    this.el.classList.add('is-busy');
    if (!SR) {
      this.voiceStatus.textContent = 'Voice input is not available in this browser';
      this.el.classList.remove('is-busy');
      return;
    }
    this.voiceStatus.textContent = 'Listening\u2026';
    const rec = new SR();
    this.rec = rec;
    rec.lang = 'en-GB';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0][0].transcript;
      this.voiceStatus.textContent = 'Thinking\u2026';
      this.#voiceAnswer(said);
    };
    rec.onerror = () => { this.voiceStatus.textContent = 'Could not hear that'; this.el.classList.remove('is-busy'); };
    rec.start();
  }

  async #voiceAnswer(q) {
    const { steps, answer } = this.#resolve(q);
    this.voiceSteps.innerHTML = `<li class="voice__said">\u201c${q}\u201d</li>`;
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 420));
      this.voiceSteps.insertAdjacentHTML('beforeend', `<li>${step}</li>`);
    }
    this.voiceStatus.textContent = 'Speaking\u2026';
    this.el.classList.remove('is-busy');
    this.voiceSteps.insertAdjacentHTML('beforeend', `<li class="voice__answer">${answer}</li>`);
    if (globalThis.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(answer);
      u.lang = 'en-GB';
      u.onend = () => { this.voiceStatus.textContent = 'Ask me anything'; };
      speechSynthesis.speak(u);
    }
    this.thread.push({ role: 'me', text: q }, { role: 'bot', text: answer });
    this.#render();
  }

  #endVoice() {
    try { this.rec?.stop(); } catch { /* already stopped */ }
    globalThis.speechSynthesis?.cancel();
    this.voice.hidden = true;
    this.el.classList.remove('is-busy');
    this.input.focus();
  }

  /** The dot earns its place: it appears only when an area is actually critical. */
  #refreshBadge() {
    const urgent = this.#scored().some((r) => OEE_BAND(r.oee.oee) === 'crit')
      || this.areas.some((a) => this.sim.countsOfArea(a.id).crit > 0);
    this.dot.hidden = !urgent;
  }

  /** Every recommended action BRUCE currently has, flattened across areas. */
  #recommendations() {
    return Object.entries(INSIGHT).flatMap(([areaId, ins]) => {
      const area = this.areas.find((a) => a.id === areaId);
      if (!area) return [];
      return ins.actions.map((act) => ({ area, ins, act }));
    });
  }

  /** The opening state of Insights: the plant, and nothing else. */
  #overview() {
    if (!this.#scored().length) return '';
    const k = this.sim.plantKpis(this.areas.map((a) => a.id));
    const band = (v) => (v == null ? 'none' : v >= 85 ? 'good' : v >= 70 ? 'warn' : 'crit');
    const row = (label, value, bd = 'none') =>
      `<li><span class="ov__k">${label}</span><span class="ov__v" data-band="${bd}">${value}</span></li>`;

    return `
      <section class="ov">
        <h4 class="ov__title">Plant Overview</h4>
        <ul class="ov__rows">
          ${row('Plant Health', `${k.health.toFixed(0)}/100`, band(k.health))}
          ${k.oee == null ? '' : row('OEE', `${k.oee.toFixed(1)}%`, band(k.oee))}
          ${row('Production', `${k.production.value.toFixed(0)} TPH`)}
          ${row('Energy', `${k.energy.sec.toFixed(0)} kcal/kg`)}
        </ul>
      </section>`;
  }

  #render() {
    this.#refreshBadge();
    for (const t of this.el.querySelectorAll('[data-tab]')) {
      t.setAttribute('aria-selected', String(t.dataset.tab === this.tab));
    }
    this.bodyEl.innerHTML = this.tab === 'recommendations' ? this.#renderRecs() : this.#renderInsights();
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  #renderRecs() {
    const recs = this.#recommendations();
    if (!recs.length) return '<p class="bruce__empty">No open recommendations. Every instrumented area is inside its limits.</p>';
    const byArea = new Map();
    for (const r of recs) {
      if (!byArea.has(r.area.id)) byArea.set(r.area.id, { area: r.area, ins: r.ins, acts: [] });
      byArea.get(r.area.id).acts.push(r.act);
    }
    return [...byArea.values()].map((g) => `
      <section class="rec">
        <header class="rec__head">
          <button class="rec__area" type="button" data-area="${g.area.id}">${g.area.name}</button>
          <span class="rec__chip">${g.ins.oeeImpact}</span>
        </header>
        <p class="rec__cause">${g.ins.rootCause}</p>
        <ul class="rec__list">
          ${g.acts.map((a) => `<li><span class="rec__tick" aria-hidden="true">\u2713</span>
            <span>${a.text}<i>${a.detail}</i></span></li>`).join('')}
        </ul>
        <div class="rec__impact"><span>Impact</span><b>${g.ins.impact}</b></div>
      </section>`).join('');
  }

  #renderInsights() {
    const thread = this.thread.map((m) => {
      if (m.role === 'me') return `<p class="bruce__q">${m.text}</p>`;
      if (m.role === 'steps') {
        return `<ul class="bruce__steps">${m.steps
          .map((x) => `<li data-state="done"><span class="bruce__bullet" aria-hidden="true"></span>${x}</li>`).join('')}</ul>`;
      }
      if (m.assessment) return this.#renderAssessment(m);
      return `<p class="bruce__a">${m.text}</p>`
        + (m.chips?.length ? `<div class="bruce__chips">${m.chips
          .map((a) => `<button class="bruce__chip" type="button" data-area="${a.id}">${a.name}</button>`).join('')}</div>` : '');
    }).join('');
    return `${this.#overview()}${thread}`;
  }

  /**
   * The assessment card.
   *
   * Figures are stated with the qualifier the data supports and no more: a
   * benchmark we do not hold is named as something to compare against rather
   * than asserted, and the cause is offered as a hypothesis with the evidence it
   * would need.
   */
  #renderAssessment(m) {
    const { area, data: d, insight } = m;
    const row = (label, value, note) =>
      `<li><span class="as__k">${label}</span><span class="as__v">${value}</span>${
        note ? `<span class="as__n">${note}</span>` : ''}</li>`;

    const perf = [];
    if (d.production) {
      const gap = ((d.production.rated - d.production.output) / d.production.rated) * 100;
      perf.push(row('Production',
        `${d.production.output.toFixed(0)} / ${d.production.rated} ${d.production.unit.toUpperCase()}`,
        gap > 1 ? `${gap.toFixed(1)}% below target` : 'at target'));
    }
    if (d.sec?.value != null) {
      perf.push(row(d.sec.label,
        `${d.sec.value.toFixed(d.sec.unit === 'kcal/kg' ? 0 : 1)} ${d.sec.unit}${d.sec.unit === 'kcal/kg' ? ' clinker' : ''}`,
        'compare with plant target/benchmark'));
    }
    if (d.oee != null) perf.push(row('OEE', `${d.oee.toFixed(1)}%`));

    const cond = [];
    if (d.refractory != null) {
      perf.length;
      cond.push(row('Refractory Health', `${d.refractory.toFixed(0)}/100`,
        d.refractory >= 85 ? 'healthy' : d.refractory >= 70 ? 'monitor' : 'attention needed'));
    }
    if (d.shellT != null) {
      cond.push(row('Shell Temperature', `${d.shellT.toFixed(0)}\u00b0C`,
        d.hotSpots ? 'elevated; check against plant alarm limit' : 'within band'));
    }
    if (d.hotSpots != null) {
      cond.push(row('Hot Spots', `${d.hotSpots}`,
        d.hotSpots ? `active hot spot${d.hotSpots === 1 ? '' : 's'} detected` : 'none detected'));
    }

    const section = (title, items) => (items.length
      ? `<h5 class="as__h">${title}</h5><ul class="as__list">${items.join('')}</ul>` : '');

    return `
      <section class="as">
        ${section(`${area.name} Performance`, perf)}
        ${section(`${area.name} Condition`, cond)}
        <h5 class="as__h">Current Issues</h5>
        ${d.anomalies.length
          ? `<ul class="as__list">${d.anomalies.slice(0, 5).map((x) => row(
              x.name, `${x.value.toFixed(x.decimals)} ${x.unit}`)).join('')}</ul>`
          : '<p class="as__p">No tag is outside its limits.</p>'}
        <h5 class="as__h">Likely Cause</h5>
        <p class="as__p">${insight
          ? `${insight.cause ?? insight.rootCause}, if supported by ${insight.evidenceNeeded ?? 'the underlying trends'}.`
          : 'No finding is open on this area, and the current readings do not point at a single cause.'}</p>
        <h5 class="as__h">Recommended Action</h5>
        ${insight
          ? `<ul class="as__acts">${insight.actions.map((x) => `<li>${x.text}</li>`).join('')}</ul>`
          : '<p class="as__p">None outstanding.</p>'}
      </section>`;
  }

  async #ask(q) {
    if (!this.open) this.toggle(true);
    this.tab = 'insights';
    const res = this.#resolve(q);
    const { steps, answer, chips = [] } = res;
    this.thread.push({ role: 'me', text: q });
    this.thread.push({ role: 'steps', steps: [] });
    const trail = this.thread[this.thread.length - 1];
    this.#render();

    // Pace the trail so an assessment lands at about 6.5 s and a short answer at
    // about 3 s. (Measured higher under a software renderer, where frames are
    // slow enough to delay the timers.)
    const total = res.kind === 'assessment' ? 6500 : 3000;
    const per = Math.max(260, Math.round(total / (steps.length + 1)));
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, per));
      trail.steps.push(step);
      this.#render();
    }
    await new Promise((r) => setTimeout(r, per));
    this.thread.push(res.kind === 'assessment'
      ? { role: 'bot', assessment: true, area: res.area, data: res.data, insight: res.insight }
      : { role: 'bot', text: answer, chips });
    this.#render();
  }
}
