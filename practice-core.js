/* HFD Qbank Practice Test: pure draw/score logic (browser global PTCore; Node module.exports). */
(function (root) {
  'use strict';
  const BLOCKS = ['1', '2', '3'];
  const MODES = ['F', 'B']; // F = First-pass Qbank, B = Block Qbank
  const MODE_NAME = { F: 'First-pass', B: 'Block Qbank' };
  const modeOf = q => (q.tier === 'first-pass' ? 'F' : 'B');
  const isSA = q => q.format === 'short-answer';

  // mulberry32 seeded RNG (tests use a seed; the app uses a random seed)
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // selection: {'F1':true,'B1':true,...}; includeSA: include Junqueira short-answer items
  function pools(questions, selection, includeSA) {
    const out = {};
    for (const b of BLOCKS) { out[b] = {}; for (const m of MODES) out[b][m] = []; }
    for (const q of questions) {
      const m = modeOf(q);
      if (!out[q.block] || !selection[m + q.block]) continue;
      if (isSA(q) && !includeSA) continue;
      out[q.block][m].push(q);
    }
    return out;
  }
  function poolSizes(p) { const s = {}; for (const b of BLOCKS) s[b] = { F: p[b].F.length, B: p[b].B.length, total: p[b].F.length + p[b].B.length }; return s; }

  // Largest-remainder apportionment of `length` by percentages.
  function fromPercent(length, pct) {
    const raw = BLOCKS.map(b => (length * (+pct[b] || 0)) / 100);
    const base = raw.map(Math.floor); let left = length - base.reduce((x, y) => x + y, 0);
    const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; k < order.length && left > 0; k++) { if (+pct[BLOCKS[order[k][1]]] > 0) { base[order[k][1]]++; left--; } }
    const o = {}; BLOCKS.forEach((b, i) => (o[b] = base[i])); return o;
  }

  // split: {unit:'count'|'pct', v:{'1':n,'2':n,'3':n}} -> {ok, errors[], warnings[], requested{}, targets{}, total}
  function resolve(length, split, sizes) {
    const errors = [], warnings = [];
    length = Math.floor(+length);
    if (!(length > 0)) errors.push('Test length must be a positive number.');
    const v = {}; for (const b of BLOCKS) { const x = +split.v[b]; v[b] = Number.isFinite(x) && x >= 0 ? x : NaN; if (Number.isNaN(v[b])) errors.push(`B${b}: enter a number ≥ 0.`); }
    let requested = { '1': 0, '2': 0, '3': 0 };
    if (!errors.length) {
      if (split.unit === 'pct') {
        const sum = BLOCKS.reduce((s, b) => s + v[b], 0);
        if (Math.abs(sum - 100) > 1e-9) errors.push(`Percentages add up to ${+sum.toFixed(2)}%, not 100%.`);
        else requested = fromPercent(length, v);
      } else {
        for (const b of BLOCKS) if (!Number.isInteger(v[b])) errors.push(`B${b}: counts must be whole numbers.`);
        const sum = BLOCKS.reduce((s, b) => s + v[b], 0);
        if (!errors.length && sum !== length) errors.push(`Block counts add up to ${sum}, not the test length ${length}.`);
        if (!errors.length) for (const b of BLOCKS) requested[b] = v[b];
      }
    }
    const targets = {};
    for (const b of BLOCKS) {
      const avail = sizes[b].total; targets[b] = Math.min(requested[b], avail);
      if (requested[b] > avail) warnings.push(`B${b}: asked for ${requested[b]} but only ${avail} available with the selected qbanks; capped at ${avail}.`);
    }
    const total = BLOCKS.reduce((s, b) => s + targets[b], 0);
    if (!errors.length && total === 0) errors.push('No questions to draw: select at least one qbank with questions in a block that has a share.');
    return { ok: !errors.length, errors, warnings, requested, targets, total };
  }

  // progress = main qbank localStorage object {a:{id:{first,...}}}
  function priority(q, progress) {
    const a = progress && progress.a && progress.a[q.id];
    if (!a || !a.first) return 0; // unseen
    const correct = isSA(q) ? a.first === 'got' : a.first === q.answer;
    return correct ? 2 : 1; // missed before correct
  }
  function pick(list, n, r, prefer, progress) {
    let a = shuffle(list, r);
    if (prefer) a = a.map((q, i) => [priority(q, progress), i, q]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]);
    return a.slice(0, n);
  }

  // settings: {selection, includeSA, length, split, proportional, preferUnseen}
  function draw(questions, settings, progress, seed) {
    const r = rng(seed == null ? Math.floor(Math.random() * 2 ** 32) : seed);
    const p = pools(questions, settings.selection, settings.includeSA);
    const res = resolve(settings.length, settings.split, poolSizes(p));
    if (!res.ok) return { ok: false, res, ids: [] };
    let chosen = [];
    for (const b of BLOCKS) {
      const n = res.targets[b]; if (!n) continue;
      const modes = MODES.filter(m => p[b][m].length);
      if (settings.proportional || modes.length < 2) {
        chosen = chosen.concat(pick(modes.flatMap(m => p[b][m]), n, r, settings.preferUnseen, progress));
      } else {
        // even split across included modes; overflow to the other mode when one runs out
        const want = {}; const base = Math.floor(n / modes.length); modes.forEach(m => (want[m] = base));
        let extra = n - base * modes.length; for (const m of shuffle(modes, r)) { if (extra > 0) { want[m]++; extra--; } }
        let spill = 0; for (const m of modes) { if (want[m] > p[b][m].length) { spill += want[m] - p[b][m].length; want[m] = p[b][m].length; } }
        for (const m of modes) { const room = p[b][m].length - want[m]; const add = Math.min(room, spill); want[m] += add; spill -= add; }
        for (const m of modes) chosen = chosen.concat(pick(p[b][m], want[m], r, settings.preferUnseen, progress));
      }
    }
    return { ok: true, res, ids: shuffle(chosen, r).map(q => q.id) };
  }

  // answers: {id: 'A'..} for MCQ, {id:'got'|'miss'} for short-answer; unanswered counts as incorrect
  function correct(q, ans) { if (ans == null) return false; return isSA(q) ? ans === 'got' : ans === q.answer; }
  function score(questions, ids, answers) {
    const byId = {}; for (const q of questions) byId[q.id] = q;
    const blank = () => ({ c: 0, n: 0, pct: 0 });
    const out = { overall: blank(), byBlock: {}, byMode: {}, byLecture: {}, missed: [], unanswered: 0 };
    const add = (o, k, ok) => { const x = o[k] || (o[k] = blank()); x.n++; if (ok) x.c++; };
    for (const id of ids) {
      const q = byId[id]; if (!q) continue; const a = answers[id]; const ok = correct(q, a);
      if (a == null) out.unanswered++;
      out.overall.n++; if (ok) out.overall.c++;
      add(out.byBlock, q.block, ok); add(out.byMode, MODE_NAME[modeOf(q)], ok); add(out.byLecture, q.lecture, ok);
      if (!ok) out.missed.push(id);
    }
    const fin = x => { x.pct = x.n ? Math.round((100 * x.c) / x.n) : 0; };
    fin(out.overall); [out.byBlock, out.byMode, out.byLecture].forEach(o => Object.values(o).forEach(fin));
    return out;
  }

  // ---- stable option identity ----
  // q.oid maps each display letter to the option's stable id (its letter in the source). Answers are
  // saved by id and shown by letter, so a reshuffled build never moves a saved answer onto other text.
  // Saves from before the shuffle hold source letters, which are exactly those ids. An id that no
  // longer exists loads as '?id' (never equal to a letter, so it grades as wrong) and saves back as id.
  function optId(q, v) {
    if (typeof v !== 'string') return v;
    if (v[0] === '?') return v.slice(1);
    return q && q.oid && q.oid[v] != null ? q.oid[v] : v;
  }
  function optLetter(q, v) {
    if (typeof v !== 'string' || !q || !q.oid) return v;
    for (const L in q.oid) if (q.oid[L] === v) return L;
    return v[0] === '?' ? v : '?' + v;
  }
  const mapVals = (o, f) => { const r = {}; for (const k in o) r[k] = f(k, o[k]); return r; };
  // main qbank progress {a:{qid:{first,last,...}}, f:{...}}
  function mapProgress(byId, prog, f) {
    if (!prog || !prog.a) return prog;
    return Object.assign({}, prog, { a: mapVals(prog.a, (id, x) => { const y = Object.assign({}, x); for (const k of ['first', 'last']) if (y[k] != null) y[k] = f(byId[id], y[k]); return y; }) });
  }
  // practice store {current:{answers}, history:[{answers}]}
  function mapPractice(byId, st, f) {
    if (!st) return st;
    const ans = o => (o && o.answers ? Object.assign({}, o, { answers: mapVals(o.answers, (id, v) => f(byId[id], v)) }) : o);
    return Object.assign({}, st, { current: ans(st.current), history: (st.history || []).map(ans) });
  }

  const api = { BLOCKS, MODES, MODE_NAME, modeOf, isSA, rng, shuffle, pools, poolSizes, fromPercent, resolve, priority, draw, score, correct, optId, optLetter, mapProgress, mapPractice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PTCore = api;
})(typeof self !== 'undefined' ? self : this);
