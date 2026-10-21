// node --test tests/practice.test.js   (Node 18+). Draw/score logic for the Practice Test tab.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'practice-core.js'));
const D = require(path.join(__dirname, '..', 'hfd_qbank.json'));
const Q = D.questions, byId = Object.fromEntries(Q.map(q => [q.id, q]));
const ALL = { F1: true, B1: true, F2: true, B2: true, F3: true, B3: true };
const S = (o = {}) => Object.assign({ selection: ALL, includeSA: false, length: 40, split: { unit: 'count', v: { 1: 10, 2: 10, 3: 20 } }, proportional: false, preferUnseen: false }, o);
const per = ids => ids.reduce((o, id) => (o[byId[id].block] = (o[byId[id].block] || 0) + 1, o), {});

test('counts are honored exactly and there are no duplicates', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const d = C.draw(Q, S(), null, seed);
    assert.ok(d.ok); assert.equal(d.ids.length, 40);
    assert.equal(new Set(d.ids).size, 40);
    assert.deepEqual(per(d.ids), { 1: 10, 2: 10, 3: 20 });
  }
});

test('percentages are apportioned to the length and must sum to 100', () => {
  const d = C.draw(Q, S({ length: 60, split: { unit: 'pct', v: { 1: 20, 2: 30, 3: 50 } } }), null, 7);
  assert.deepEqual(per(d.ids), { 1: 12, 2: 18, 3: 30 });
  assert.deepEqual(C.fromPercent(20, { 1: 33.4, 2: 33.3, 3: 33.3 }), { 1: 7, 2: 7, 3: 6 });
  const r = C.resolve(20, { unit: 'pct', v: { 1: 40, 2: 40, 3: 10 } }, C.poolSizes(C.pools(Q, ALL, false)));
  assert.equal(r.ok, false); assert.match(r.errors[0], /90%/);
  const r2 = C.resolve(40, { unit: 'count', v: { 1: 10, 2: 10, 3: 10 } }, C.poolSizes(C.pools(Q, ALL, false)));
  assert.equal(r2.ok, false); assert.match(r2.errors[0], /30, not the test length 40/);
  const zero = C.draw(Q, S({ length: 20, split: { unit: 'pct', v: { 1: 0, 2: 0, 3: 100 } } }), null, 3);
  assert.deepEqual(per(zero.ids), { 3: 20 });
});

test('only selected qbanks are drawn from', () => {
  const sel = { F1: true, B1: false, F2: false, B2: true, F3: true, B3: false };
  for (let seed = 1; seed <= 10; seed++) {
    const d = C.draw(Q, S({ selection: sel }), null, seed);
    for (const id of d.ids) assert.ok(sel[C.modeOf(byId[id]) + byId[id].block], id);
  }
  // short-answer (Junqueira) only with the toggle
  const noSA = C.draw(Q, S({ length: 100, split: { unit: 'count', v: { 1: 30, 2: 40, 3: 30 } }, selection: { B1: true, B2: true, B3: true } }), null, 1);
  assert.ok(noSA.ids.every(id => !C.isSA(byId[id])));
  const sizes = C.poolSizes(C.pools(Q, { B1: true }, true));
  assert.equal(sizes['1'].B, Q.filter(q => q.block === '1' && q.tier !== 'first-pass').length);
  const withSA = C.draw(Q, S({ includeSA: true, length: sizes['1'].B, selection: { B1: true }, split: { unit: 'pct', v: { 1: 100, 2: 0, 3: 0 } } }), null, 1);
  assert.ok(withSA.ids.some(id => C.isSA(byId[id])));
});

test('requests beyond the pool are capped with a warning', () => {
  const d = C.draw(Q, S({ selection: { B1: true, F2: true, F3: true }, length: 60, split: { unit: 'count', v: { 1: 40, 2: 10, 3: 10 } } }), null, 2);
  const pool1 = Q.filter(q => q.block === '1' && q.tier !== 'first-pass' && q.format !== 'short-answer').length;
  assert.ok(d.ok); assert.equal(per(d.ids)['1'], pool1); assert.equal(d.ids.length, pool1 + 20);
  assert.match(d.res.warnings[0], new RegExp(`only ${pool1} available`));
});

test('even split across modes by default; proportional option follows the union', () => {
  const d = C.draw(Q, S({ length: 20, split: { unit: 'count', v: { 1: 0, 2: 20, 3: 0 } } }), null, 5);
  const m = d.ids.reduce((o, id) => (o[C.modeOf(byId[id])]++, o), { F: 0, B: 0 });
  assert.deepEqual(m, { F: 10, B: 10 });
  // B1 Block Qbank has only 15 MCQs: an even 40-question B1 draw spills the rest into First-pass
  const s = C.draw(Q, S({ length: 40, split: { unit: 'count', v: { 1: 40, 2: 0, 3: 0 } } }), null, 5);
  const m2 = s.ids.reduce((o, id) => (o[C.modeOf(byId[id])]++, o), { F: 0, B: 0 });
  assert.deepEqual(m2, { F: 25, B: 15 });
  const p = C.draw(Q, S({ proportional: true }), null, 9); assert.equal(new Set(p.ids).size, 40);
});

test('prefer unseen/missed uses main progress', () => {
  const b1 = Q.filter(q => q.block === '1' && q.tier === 'first-pass');
  const prog = { a: {} };
  b1.slice(0, 80).forEach(q => (prog.a[q.id] = { first: q.answer })); // 80 seen & correct, 9 unseen
  const d = C.draw(Q, S({ preferUnseen: true, selection: { F1: true }, length: 9, split: { unit: 'pct', v: { 1: 100, 2: 0, 3: 0 } } }), prog, 4);
  assert.deepEqual(new Set(d.ids), new Set(b1.slice(80).map(q => q.id)));
  const wrong = b1[0]; prog.a[wrong.id] = { first: wrong.answer === 'A' ? 'B' : 'A' };
  const d2 = C.draw(Q, S({ preferUnseen: true, selection: { F1: true }, length: 10, split: { unit: 'pct', v: { 1: 100, 2: 0, 3: 0 } } }), prog, 4);
  assert.ok(d2.ids.includes(wrong.id));
});

test('scoring per block, per mode, per lecture; unanswered counts as incorrect; SA uses self-grade', () => {
  const ids = [], answers = {};
  const take = (b, n, nCorrect) => { Q.filter(q => q.block === b && q.format !== 'short-answer').slice(0, n).forEach((q, i) => { ids.push(q.id); answers[q.id] = i < nCorrect ? q.answer : (q.answer === 'A' ? 'B' : 'A'); }); };
  take('1', 10, 6); take('2', 10, 9); take('3', 10, 8);
  const sa = Q.filter(q => C.isSA(q) && q.block === '2').slice(0, 2); sa.forEach((q, i) => { ids.push(q.id); answers[q.id] = i ? 'miss' : 'got'; });
  const blank = Q.find(q => q.block === '3' && !ids.includes(q.id) && q.format !== 'short-answer'); ids.push(blank.id);
  const s = C.score(Q, ids, answers);
  assert.deepEqual([s.byBlock['1'].c, s.byBlock['1'].n, s.byBlock['1'].pct], [6, 10, 60]);
  assert.deepEqual([s.byBlock['2'].c, s.byBlock['2'].n, s.byBlock['2'].pct], [10, 12, 83]); // 9/10 MCQ + 1/2 self-graded
  assert.equal(s.byBlock['3'].n, 11); assert.equal(s.byBlock['3'].c, 8);
  assert.equal(s.overall.n, 33); assert.equal(s.overall.c, 6 + 9 + 8 + 1); assert.equal(s.unanswered, 1);
  assert.equal(s.missed.length, 33 - 24); assert.ok(s.missed.includes(blank.id));
  const lecN = Object.values(s.byLecture).reduce((a, x) => a + x.n, 0), modeN = Object.values(s.byMode).reduce((a, x) => a + x.n, 0);
  assert.equal(lecN, 33); assert.equal(modeN, 33);
});
