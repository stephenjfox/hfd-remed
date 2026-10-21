/* HFD Qbank Practice Test UI. Uses app globals (D, S, esc, card, figs, mathify, lecColor, nav, view) at call time.
   Storage is separate from the main qbank progress (hfdqbank.v1):
     hfdqbank.pt.v1      {settings, presets, history[], current}
     hfdqbank.pt.missed  {questionId: timesMissedInTests}   ("Test-missed" review pill in the qbank tabs) */
(function () {
  const C = window.PTCore, KEY = 'hfdqbank.pt.v1', MKEY = 'hfdqbank.pt.missed';
  const DEF = { selection: { F1: true, B1: true, F2: true, B2: true, F3: true, B3: true }, includeSA: false, length: 40,
    split: { unit: 'pct', v: { 1: 34, 2: 33, 3: 33 } }, proportional: false, preferUnseen: false, timer: false, secsPerQ: 90 };
  let st; try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
  st = Object.assign({ settings: JSON.parse(JSON.stringify(DEF)), presets: {}, history: [], current: null }, st || {});
  st.settings = Object.assign(JSON.parse(JSON.stringify(DEF)), st.settings);
  // Answers are saved by stable option id and held in memory by display letter (PTCore.optId/optLetter).
  // D is only defined once the app script runs, so the stored ids are converted on first use.
  let byId = null;
  const ready = () => { if (!byId) { byId = Object.fromEntries(D.questions.map(q => [q.id, q])); st = C.mapPractice(byId, st, C.optLetter); } };
  const save = () => { ready(); localStorage.setItem(KEY, JSON.stringify(C.mapPractice(byId, st, C.optId))); };
  const missedStore = () => { try { return JSON.parse(localStorage.getItem(MKEY) || '{}'); } catch (e) { return {}; } };
  const qById = id => D.questions.find(q => q.id === id);
  const $ = id => document.getElementById(id);
  const pctTxt = x => (x.n ? `${x.pct}%` : '–');
  const splitTxt = s => s.split.unit === 'pct' ? C.BLOCKS.map(b => `B${b} ${+s.split.v[b]}%`).join(' · ') : C.BLOCKS.map(b => `B${b} ${+s.split.v[b]}`).join(' · ');
  const qbTxt = s => C.BLOCKS.map(b => C.MODES.filter(m => s.selection[m + b]).map(m => `${m === 'F' ? 'FP' : 'BQ'}${b}`).join('+')).filter(Boolean).join(', ');
  let timerH = null, ui = { review: 'all' };

  function render(arg) {
    clearInterval(timerH); timerH = null;
    const app = $('app');
    if (arg && arg[0] === 'r') { const h = st.history.find(x => x.id === arg.slice(1)); if (h) return results(app, h); }
    if (st.current) return exam(app);
    return builder(app);
  }

  /* ---------------- builder ---------------- */
  function sizesNow() { const s = st.settings; return C.poolSizes(C.pools(D.questions, s.selection, s.includeSA)); }
  function builder(app) {
    const s = st.settings, presets = Object.keys(st.presets);
    const chk = (k, label, n) => `<label class="pt-chk"><input type="checkbox" data-sel="${k}" ${s.selection[k] ? 'checked' : ''}><span>${label} <span class="muted mono" id="cnt-${k}">${n}</span></span></label>`;
    const all = C.poolSizes(C.pools(D.questions, { F1: 1, B1: 1, F2: 1, B2: 1, F3: 1, B3: 1 }, s.includeSA));
    app.innerHTML = `<div class="pt">
<div class="kicker">MS1 HFD remediation · timed mixed-block practice</div><h1>Practice Test</h1>
<p class="muted">Draw a test across blocks, answer with no feedback, then submit for per-block scores. Practice answers are kept separate from your qbank first-try progress.</p>
<div class="box"><h3>1 · Question sources</h3><div class="pt-six">${C.BLOCKS.map(b => chk('F' + b, `B${b} First-pass`, all[b].F) + chk('B' + b, `B${b} Block Qbank`, all[b].B)).join('')}</div>
<label class="pt-chk"><input type="checkbox" id="pt-sa" ${s.includeSA ? 'checked' : ''}><span>Include Junqueira open-ended items <span class="muted">(self-graded; scored from your self-grade)</span></span></label></div>
<div class="box"><h3>2 · Length</h3><div class="pills">${[20, 40, 60, 100].map(n => `<button class="pill ${s.length === n ? 'on' : ''}" data-len="${n}">${n}</button>`).join('')}
<label class="pt-inline">Custom <input type="number" min="1" max="999" id="pt-len" value="${s.length}" inputmode="numeric"></label></div></div>
<div class="box"><h3>3 · Block split</h3>
<div class="pills"><button class="pill ${s.split.unit === 'pct' ? 'on' : ''}" data-unit="pct">Percentages</button><button class="pill ${s.split.unit === 'count' ? 'on' : ''}" data-unit="count">Counts</button></div>
<div class="pt-split">${C.BLOCKS.map(b => `<label><b>B${b}</b> <span class="muted pt-bname">${esc(D.blocks[b])}</span><span class="pt-in"><input type="number" min="0" step="${s.split.unit === 'pct' ? 'any' : '1'}" data-split="${b}" value="${s.split.v[b]}" inputmode="decimal">${s.split.unit === 'pct' ? '%' : 'q'}</span><span class="muted pt-pool" id="pool-${b}"></span></label>`).join('')}</div>
<div id="pt-val" class="pt-val"></div>
<div class="pt-presets"><select id="pt-preset"><option value="">Saved splits…</option>${presets.map(p => `<option>${esc(p)}</option>`).join('')}</select>
<button id="pt-pdel" ${presets.length ? '' : 'disabled'}>Delete</button>
<input id="pt-pname" placeholder="Name this split (e.g. My exam split)"><button id="pt-psave">Save split</button></div></div>
<div class="box"><h3>4 · Options</h3>
<label class="pt-chk"><input type="checkbox" id="pt-prop" ${s.proportional ? 'checked' : ''}><span>Within a block, draw proportional to pool size <span class="muted">(off: split evenly between First-pass and Block Qbank)</span></span></label>
<label class="pt-chk"><input type="checkbox" id="pt-pref" ${s.preferUnseen ? 'checked' : ''}><span>Prefer questions I haven't seen, then ones I missed <span class="muted">(uses your qbank progress)</span></span></label>
<label class="pt-chk"><input type="checkbox" id="pt-tim" ${s.timer ? 'checked' : ''}><span>Countdown timer</span></label>
<label class="pt-inline" style="margin-left:30px">Seconds per question <input type="number" min="10" max="600" id="pt-spq" value="${s.secsPerQ}" inputmode="numeric"></label></div>
<div class="pt-start"><button class="pri" id="pt-go">Start test</button><span class="muted" id="pt-sum"></span></div>
${history()}</div>`;
    app.querySelectorAll('[data-sel]').forEach(e => e.onchange = () => { s.selection[e.dataset.sel] = e.checked; save(); validate(); });
    $('pt-sa').onchange = e => { s.includeSA = e.target.checked; save(); builder(app); };
    app.querySelectorAll('[data-len]').forEach(e => e.onclick = () => { s.length = +e.dataset.len; save(); builder(app); });
    $('pt-len').oninput = e => { s.length = Math.floor(+e.target.value) || 0; save(); app.querySelectorAll('[data-len]').forEach(x => x.classList.toggle('on', +x.dataset.len === s.length)); validate(); };
    app.querySelectorAll('[data-unit]').forEach(e => e.onclick = () => {
      const u = e.dataset.unit; if (u === s.split.unit) return;
      if (u === 'count') { const r = C.resolve(s.length, s.split, sizesNow()); s.split = { unit: 'count', v: r.ok ? Object.assign({}, r.requested) : C.fromPercent(s.length, { 1: 34, 2: 33, 3: 33 }) }; }
      else { const t = C.BLOCKS.reduce((a, b) => a + (+s.split.v[b] || 0), 0) || 1; const v = {}; C.BLOCKS.forEach(b => v[b] = Math.round(1000 * (+s.split.v[b] || 0) / t) / 10); v[3] = Math.round((100 - v[1] - v[2]) * 10) / 10; s.split = { unit: 'pct', v }; }
      save(); builder(app); });
    app.querySelectorAll('[data-split]').forEach(e => e.oninput = () => { s.split.v[e.dataset.split] = e.value === '' ? '' : +e.value; save(); validate(); });
    $('pt-prop').onchange = e => { s.proportional = e.target.checked; save(); };
    $('pt-pref').onchange = e => { s.preferUnseen = e.target.checked; save(); };
    $('pt-tim').onchange = e => { s.timer = e.target.checked; save(); validate(); };
    $('pt-spq').oninput = e => { s.secsPerQ = Math.max(10, Math.floor(+e.target.value) || 90); save(); validate(); };
    $('pt-preset').onchange = e => { const p = st.presets[e.target.value]; if (p) { s.split = JSON.parse(JSON.stringify(p.split)); if (p.length) s.length = p.length; save(); builder(app); $('pt-preset').value = e.target.value; } };
    $('pt-psave').onclick = () => { const n = $('pt-pname').value.trim(); if (!n) { $('pt-pname').focus(); return; } st.presets[n] = { split: JSON.parse(JSON.stringify(s.split)), length: s.length }; save(); builder(app); $('pt-preset').value = n; };
    $('pt-pdel').onclick = () => { const n = $('pt-preset').value; if (n && st.presets[n]) { delete st.presets[n]; save(); builder(app); } };
    $('pt-go').onclick = () => start(s);
    app.querySelectorAll('[data-retake]').forEach(e => e.onclick = () => { const h = st.history.find(x => x.id === e.dataset.retake); if (h) start(h.settings); });
    validate();
  }
  function validate() {
    const s = st.settings, sz = sizesNow(), r = C.resolve(s.length, s.split, sz);
    C.BLOCKS.forEach(b => { const el = $('pool-' + b); if (el) el.textContent = `pool ${sz[b].total} (FP ${sz[b].F} · BQ ${sz[b].B})` + (r.ok ? ` → ${r.targets[b]} q` : ''); });
    const sum = C.BLOCKS.reduce((a, b) => a + (+s.split.v[b] || 0), 0);
    const goal = s.split.unit === 'pct' ? `${+sum.toFixed(2)}% of 100%` : `${sum} of ${s.length}`;
    $('pt-val').innerHTML = `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} Split totals ${goal}</div>` + r.errors.map(e => `<div class="bad">${esc(e)}</div>`).join('') + r.warnings.map(e => `<div class="warn">⚠ ${esc(e)}</div>`).join('');
    $('pt-go').disabled = !r.ok;
    $('pt-sum').textContent = r.ok ? `${r.total} questions${r.total < s.length ? ` (capped from ${s.length})` : ''}${s.timer ? ` · ${fmt(r.total * s.secsPerQ)} on the clock` : ''}` : 'Fix the split to start';
  }
  function start(settings) {
    const s = JSON.parse(JSON.stringify(settings));
    const d = C.draw(D.questions, s, typeof S !== 'undefined' ? S : null);
    if (!d.ok || !d.ids.length) { alert('Cannot draw: ' + d.res.errors.join(' ')); return; }
    st.current = { id: Date.now().toString(36), created: new Date().toISOString(), settings: s, ids: d.ids, answers: {}, flags: {}, reveal: {}, idx: 0,
      requested: s.length, capped: d.res.warnings, timer: s.timer ? { total: d.ids.length * s.secsPerQ, started: Date.now() } : null };
    save(); if (location.hash !== '#p-test') location.hash = '#p-test'; else render(); window.scrollTo(0, 0);
  }
  function history() {
    if (!st.history.length) return `<div class="box"><h3>Test history</h3><div class="muted">Your submitted tests will be listed here.</div></div>`;
    return `<div class="box"><h3>Test history</h3>${st.history.slice().reverse().map(h => `<div class="pt-hist"><div><b>${new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b> · ${h.ids.length} q · <span class="muted">${esc(splitTxt(h.settings))}</span></div>
<div class="pt-hscore"><b class="mono">${pctTxt(h.score.overall)}</b> ${C.BLOCKS.filter(b => h.score.byBlock[b]).map(b => `<span class="chip">B${b} ${pctTxt(h.score.byBlock[b])} <span class="muted">${h.score.byBlock[b].c}/${h.score.byBlock[b].n}</span></span>`).join('')}</div>
<div class="pt-hbtn"><a class="btn" href="#p-r${h.id}">Review</a><button data-retake="${h.id}">New draw, same settings</button></div></div>`).join('')}</div>`;
  }

  /* ---------------- exam ---------------- */
  const fmt = t => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const remaining = c => c.timer ? c.timer.total - (Date.now() - c.timer.started) / 1000 : null;
  function exam(app) {
    const c = st.current, q = qById(c.ids[c.idx]); if (!q) { st.current = null; save(); return render(); }
    const n = c.ids.length, answered = c.ids.filter(id => c.answers[id] != null).length, sa = C.isSA(q), a = c.answers[q.id];
    let body;
    if (!sa) body = Object.entries(q.choices).map(([L, t]) => `<div class="ch ${a === L ? 'sel' : ''}" role="button" onclick="PT.pick('${L}')"><span class="L">${L}</span><span>${esc(t)}</span></div>`).join('');
    else body = !c.reveal[q.id] ? `<p class="muted">Open-ended (Junqueira). Answer in your head, then reveal and grade yourself; your self-grade is scored.</p><button class="pri" onclick="PT.reveal()">Show answer</button>`
      : `<div class="kicker" style="margin-top:6px">Junqueira's answer</div><div class="expl">${esc(q.model_answer)}</div><div class="pt-sa"><button class="${a === 'got' ? 'pri' : ''}" onclick="PT.pick('got')">I got it</button><button class="${a === 'miss' ? 'pri' : ''}" onclick="PT.pick('miss')">I missed it</button></div>`;
    app.innerHTML = `<div class="pt pt-exam">
<div class="pt-bar"><span><b>Q${c.idx + 1}</b><span class="muted">/${n}</span></span><span class="muted">${answered} answered</span>${c.timer ? `<span class="mono pt-clock" id="pt-clock">${fmt(remaining(c))}</span>` : ''}<span class="sp"></span><button onclick="PT.flag()" class="${c.flags[q.id] ? 'pri' : ''}">${c.flags[q.id] ? '★ Flagged' : '☆ Flag'}</button></div>
<details class="box pt-navbox" ${innerWidth > 700 || c.navOpen ? 'open' : ''} ontoggle="PT.navOpen(this.open)"><summary class="kicker">Question navigator · ${Object.keys(c.flags).filter(k => c.flags[k]).length} flagged</summary>
<div class="pt-navg">${c.ids.map((id, i) => `<button class="${c.answers[id] != null ? 'ans' : ''} ${c.flags[id] ? 'flg' : ''} ${i === c.idx ? 'cur' : ''}" onclick="PT.go(${i})" aria-label="Question ${i + 1}">${i + 1}</button>`).join('')}</div>
<div class="muted pt-legend"><span class="sw ans"></span>answered <span class="sw flg"></span>flagged <span class="sw cur"></span>current</div></details>
<div class="box q" id="pt-card"><div class="top"><span class="badge">Q${c.idx + 1}</span><span class="tag">B${q.block}</span>${sa ? '<span class="src">short answer · self-graded</span>' : ''}</div>
<div class="stem ask">${esc(q.stem)}</div>${figs(q)}${body}</div>
<div class="pt-move"><button onclick="PT.go(${c.idx - 1})" ${c.idx ? '' : 'disabled'}>← Prev</button><button onclick="PT.go(${c.idx + 1})" ${c.idx < n - 1 ? '' : 'disabled'}>Next →</button><span class="sp"></span><button class="pri" onclick="PT.submit()">Submit test</button></div>
<div class="pt-foot"><span class="muted">No feedback until you submit. Progress is saved if you leave.</span><button onclick="PT.abandon()">Abandon test</button></div></div>`;
    mathify(app);
    if (c.timer) timerH = setInterval(() => { const r = remaining(c), el = $('pt-clock'); if (el) { el.textContent = fmt(r); el.classList.toggle('low', r < 60); } if (r <= 0) { clearInterval(timerH); submit(true); } }, 1000);
  }
  function go(i) { const c = st.current; if (!c || i < 0 || i >= c.ids.length) return; c.idx = i; save(); exam($('app')); window.scrollTo(0, 0); }
  function pick(v) { const c = st.current, id = c.ids[c.idx]; c.answers[id] = v; save(); exam($('app')); }
  function submit(auto) {
    const c = st.current; if (!c) return;
    const open = c.ids.filter(id => c.answers[id] == null).length;
    if (!auto && open && !confirm(`${open} question${open > 1 ? 's are' : ' is'} unanswered and will be scored as incorrect. Submit anyway?`)) return;
    const sc = C.score(D.questions, c.ids, c.answers);
    const h = { id: c.id, date: new Date().toISOString(), settings: c.settings, ids: c.ids, answers: c.answers, flags: c.flags, capped: c.capped,
      score: sc, seconds: Math.round(((c.timer ? c.timer.started : Date.parse(c.created)) - Date.now()) / -1000), timedOut: !!auto };
    st.history.push(h); st.current = null; save(); location.hash = '#p-r' + h.id;
  }

  /* ---------------- results + review ---------------- */
  const bar = p => `<div class="bar"><i style="width:${p}%;background:${p < 60 ? '#d64545' : p < 80 ? '#e0a526' : '#2e9d57'}"></i></div>`;
  const rows = o => Object.entries(o).sort((a, b) => a[1].pct - b[1].pct || b[1].n - a[1].n).map(([k, x]) => `<div class="row"><span>${lecColor[k] ? `<i class="dot" style="background:${lecColor[k]}"></i>` : ''}${esc(k)}</span>${bar(x.pct)}<span class="mono">${x.pct}% <span class="muted">${x.c}/${x.n}</span></span></div>`).join('');
  function results(app, h) {
    const sc = h.score, f = ui.review;
    const ids = h.ids.filter(id => f === 'x' ? sc.missed.includes(id) : f === 'f' ? h.flags[id] : true);
    app.innerHTML = `<div class="pt"><div class="kicker">Practice test · ${new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${h.ids.length} questions${h.timedOut ? ' · time expired' : ''}</div>
<h1>Results</h1>
<div class="box pt-res"><div class="pt-big"><div class="n mono">${sc.overall.pct}%</div><div class="muted">${sc.overall.c}/${sc.overall.n} correct${sc.unanswered ? ` · ${sc.unanswered} unanswered` : ''} · ${fmt(h.seconds)}</div></div>
<div class="pt-blocks">${C.BLOCKS.filter(b => sc.byBlock[b]).map(b => `<div class="pt-blk"><div class="kicker">Block ${b}</div><div class="n mono">${sc.byBlock[b].pct}%</div><div class="muted">${sc.byBlock[b].c}/${sc.byBlock[b].n}</div>${bar(sc.byBlock[b].pct)}</div>`).join('')}</div></div>
${(h.capped || []).length ? `<div class="muted">${h.capped.map(esc).join('<br>')}</div>` : ''}
<div class="box weak"><h3>By qbank</h3>${rows(sc.byMode)}</div>
<div class="box weak"><h3>By lecture <span class="muted">weakest first</span></h3>${rows(sc.byLecture)}</div>
<div class="pt-actions"><button class="pri" onclick="PT.retake('${h.id}')">New draw, same settings</button><button onclick="PT.addMissed('${h.id}')" ${h.addedMissed || !sc.missed.length ? 'disabled' : ''}>${h.addedMissed ? '✓ Added to Test-missed review' : `Add ${sc.missed.length} missed to Test-missed review`}</button><a class="btn" href="#p-test">Builder &amp; history</a></div>
<h2 class="sec">Review</h2><div class="pills">${[['all', 'All', h.ids.length], ['x', 'Incorrect', sc.missed.length], ['f', 'Flagged', h.ids.filter(id => h.flags[id]).length]].map(([k, l, n]) => `<button class="pill ${f === k ? 'on' : ''}" onclick="PT.rf('${k}')">${l} <b class="mono">${n}</b></button>`).join('')}</div>
<div id="pt-review">${ids.map(id => reviewCard(h, id)).join('') || '<div class="muted">Nothing here.</div>'}</div></div>`;
    mathify(app);
  }
  // Reuse the qbank's own card()/reveal against a throwaway progress object so the main progress (S) is never touched.
  function reviewCard(h, id) {
    const q = qById(id); if (!q) return '';
    const a = h.answers[id], keepS = S, keepN = q.n, i = h.ids.indexOf(id);
    S = { a: { [id]: C.isSA(q) ? { reveal: true, last: a || undefined } : { last: a || undefined } }, f: {} };
    q.n = i + 1; let html;
    try { html = card(q); } finally { S = keepS; q.n = keepN; }
    html = html.replace(/ onclick="(answer|flag|retry|reveal|sa)\([^"]*\)"/g, '').replace(/<button>(Flag|★ Flagged|Try again)<\/button>/g, '').replace(/<button>Show answer<\/button>/g, '').replace(/<button style="[^"]*">I (got|missed) it<\/button>/g, '')
      .replace(/<div class="box q ([^"]*)" id="[^"]*"/, `<div class="box q pt-rev $1"`);
    const tag = a == null ? '<span class="missn">Unanswered</span>' : C.correct(q, a) ? '<span class="pt-ok">✓ Correct</span>' : '<span class="missn">✗ Incorrect</span>';
    const unans = (!C.isSA(q) && a == null) ? `<div class="fb"><div class="verdict"><b class="bad">Unanswered</b> <span class="muted">The answer is ${q.answer}.</span></div>${q.explanation ? `<div class="expl">${esc(q.explanation)}</div>` : ''}${qaEv(q)}</div>` : '';
    return html.replace('<span class="sp"></span>', `${tag}${h.flags[id] ? ' <span class="muted">★ flagged</span>' : ''}<span class="sp"></span>`).replace(/<\/div>$/, unans + '</div>');
  }
  function addMissed(hid) { const h = st.history.find(x => x.id === hid); if (!h || h.addedMissed) return; const m = missedStore(); h.score.missed.forEach(id => m[id] = (m[id] || 0) + 1); localStorage.setItem(MKEY, JSON.stringify(m)); h.addedMissed = true; save(); render('r' + hid); }

  window.PT = {
    render, go, pick, submit, start, addMissed,
    reveal() { const c = st.current; c.reveal[c.ids[c.idx]] = true; save(); exam($('app')); },
    flag() { const c = st.current, id = c.ids[c.idx]; if (c.flags[id]) delete c.flags[id]; else c.flags[id] = true; save(); exam($('app')); },
    navOpen(o) { if (st.current) { st.current.navOpen = o; save(); } },
    abandon() { if (confirm('Abandon this test? It will not be scored or saved to history.')) { st.current = null; save(); render(); } },
    retake(hid) { const h = st.history.find(x => x.id === hid); if (h) start(h.settings); },
    rf(k) { ui.review = k; const h = location.hash.match(/#p-r(\w+)/); render(h ? 'r' + h[1] : undefined); },
    missed: missedStore, clearMissed() { localStorage.removeItem(MKEY); },
    _state: () => st,
  };
  for (const k of Object.keys(window.PT)) { const f = window.PT[k]; if (typeof f === 'function' && k !== 'missed' && k !== 'clearMissed') window.PT[k] = function () { ready(); return f.apply(this, arguments); }; }
})();
