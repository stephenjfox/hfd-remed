/* HFD Qbank progress transfer: pack every hfdqbank.* localStorage key into a short text code and back.
   Code format:  HFD1.<z|j>.<base64url payload>.<fnv1a-32 of payload, 8 hex>
     z = gzip (CompressionStream) of the envelope JSON; j = the envelope JSON uncompressed (fallback).
   Envelope: {app:'hfd-remed', v:1, exportedAt, keys:{'hfdqbank.v1': '<raw localStorage string>', ...}}
   Values stay the raw localStorage strings, so export -> import reproduces storage byte for byte.
   Pure functions (no DOM); works in browsers and in Node 18+ (tests). */
(function (root) {
  'use strict';
  const APP = 'hfd-remed', VERSION = 1, PREFIX = 'HFD1', NS = 'hfdqbank.', BACKUP = 'hfdqbank.backup';
  const PROGRESS = 'hfdqbank.v1', PT = 'hfdqbank.pt.v1', MISSED = 'hfdqbank.pt.missed', THEME = 'hfdqbank.theme';
  const KNOWN = [PROGRESS, PT, MISSED, THEME];
  const THEMES = ['auto', 'light', 'dark'];

  class TransferError extends Error {}
  const fail = msg => { throw new TransferError(msg); };

  // ---- storage helpers (anything with getItem/setItem/removeItem/key/length, e.g. localStorage) ----
  function keysOf(store) { const out = []; for (let i = 0; i < store.length; i++) out.push(store.key(i)); return out; }
  function collect(store) {
    const keys = {};
    for (const k of keysOf(store).sort()) if (k.startsWith(NS) && k !== BACKUP) keys[k] = store.getItem(k);
    return keys;
  }

  // ---- bytes <-> base64url ----
  function b64url(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(t) {
    if (!/^[A-Za-z0-9_-]*$/.test(t)) fail('The code contains characters that are not part of a transfer code.');
    const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
    const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b;
  }
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const hasGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

  // ---- validation of the stored values ----
  const isObj = x => x != null && typeof x === 'object' && !Array.isArray(x);
  function checkValue(k, raw) {
    if (typeof raw !== 'string') fail(`${k}: value is not text.`);
    if (k === THEME) { if (!THEMES.includes(raw)) fail(`${k}: unknown theme "${raw.slice(0, 20)}".`); return raw; }
    let v; try { v = JSON.parse(raw); } catch (e) { fail(`${k}: saved data is not valid JSON.`); }
    if (!isObj(v)) fail(`${k}: saved data has the wrong shape.`);
    if (k === PROGRESS && (!isObj(v.a) || (v.f != null && !isObj(v.f)))) fail(`${k}: answers are missing or malformed.`);
    if (k === PT && v.history != null && !Array.isArray(v.history)) fail(`${k}: test history is malformed.`);
    return v;
  }

  // ---- summary for the panel / preview ----
  function summarize(keys) {
    const parse = k => { try { return keys[k] != null && keys[k] !== '' ? JSON.parse(keys[k]) : null; } catch (e) { return null; } };
    const p = parse(PROGRESS) || {}, t = parse(PT) || {}, m = parse(MISSED) || {};
    const a = p.a || {};
    return {
      answered: Object.values(a).filter(x => x && x.first != null).length,
      flagged: Object.keys(p.f || {}).filter(k => p.f[k]).length,
      tests: (t.history || []).length,
      inProgress: !!t.current,
      savedSplits: Object.keys(t.presets || {}).length,
      testMissed: Object.keys(m).length,
      theme: keys[THEME] || null,
    };
  }

  // ---- encode / decode ----
  async function encode(keys, opts = {}) {
    const env = { app: APP, v: VERSION, exportedAt: opts.now || new Date().toISOString(), keys };
    const json = new TextEncoder().encode(JSON.stringify(env));
    const gz = opts.gzip !== false && hasGzip();
    const payload = b64url(gz ? await pipe(json, new CompressionStream('gzip')) : json);
    return `${PREFIX}.${gz ? 'z' : 'j'}.${payload}.${fnv(payload)}`;
  }
  async function decode(code) {
    const t = String(code || '').replace(/\s+/g, '');
    if (!t) fail('Paste a transfer code first.');
    const parts = t.split('.');
    if (parts[0] !== PREFIX) fail(/^HFD\d/.test(parts[0]) ? `This code is from a different version (${parts[0]}) of the transfer format.` : 'This is not an HFD Qbank transfer code (it should start with "HFD1.").');
    if (parts.length !== 4 || !['z', 'j'].includes(parts[1])) fail('The code is incomplete or damaged (wrong number of parts). Copy the whole code again.');
    const [, mode, payload, sum] = parts;
    if (fnv(payload) !== sum) fail('The code is incomplete or damaged (checksum mismatch). Copy the whole code again.');
    let bytes = unb64url(payload);
    if (mode === 'z') {
      if (!hasGzip()) fail('This browser cannot unpack compressed codes. Export again on the other device with compression off.');
      try { bytes = await pipe(bytes, new DecompressionStream('gzip')); } catch (e) { fail('The code is damaged (could not decompress).'); }
    }
    let env; try { env = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { fail('The code is damaged (unreadable contents).'); }
    if (!isObj(env) || env.app !== APP) fail('This code was made by a different app.');
    if (env.v !== VERSION) fail(`Unsupported transfer version ${env.v}.`);
    if (!isObj(env.keys)) fail('The code has no saved data.');
    const keys = {}, ignored = [];
    for (const [k, raw] of Object.entries(env.keys)) {
      if (!KNOWN.includes(k)) { ignored.push(k); continue; }
      checkValue(k, raw); keys[k] = raw;
    }
    if (!Object.keys(keys).length) fail('The code contains no qbank progress.');
    return { exportedAt: env.exportedAt || null, keys, ignored, compressed: mode === 'z', summary: summarize(keys) };
  }

  // ---- merge (both sides in stored form: option ids, not display letters) ----
  const newer = (a, b) => (a && b && a.t != null && b.t != null) ? (b.t > a.t ? b : a) : b; // incoming wins without timestamps
  function mergeProgress(curRaw, incRaw) {
    const c = curRaw ? JSON.parse(curRaw) : { a: {}, f: {} }, i = JSON.parse(incRaw);
    const a = Object.assign({}, c.a || {});
    for (const [id, x] of Object.entries(i.a || {})) a[id] = a[id] ? newer(a[id], x) : x;
    const f = Object.assign({}, c.f || {}); for (const [id, v] of Object.entries(i.f || {})) if (v) f[id] = v;
    return JSON.stringify(Object.assign({}, c, i, { a, f }));
  }
  function mergePractice(curRaw, incRaw) {
    const c = curRaw ? JSON.parse(curRaw) : {}, i = JSON.parse(incRaw);
    const byId = new Map();
    for (const h of c.history || []) byId.set(h.id, h);
    for (const h of i.history || []) { const o = byId.get(h.id); byId.set(h.id, o ? Object.assign({}, h, { addedMissed: !!(o.addedMissed || h.addedMissed) }) : h); }
    const history = [...byId.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    return JSON.stringify(Object.assign({}, c, i, {
      settings: Object.assign({}, c.settings || {}, i.settings || {}),
      presets: Object.assign({}, c.presets || {}, i.presets || {}),
      history,
      current: c.current || i.current || null, // never discard a test in progress on this device
    }));
  }
  function mergeMissed(curRaw, incRaw) {
    const c = curRaw ? JSON.parse(curRaw) : {}, i = JSON.parse(incRaw), o = Object.assign({}, c);
    for (const [id, n] of Object.entries(i)) o[id] = Math.max(+o[id] || 0, +n || 0); // same test may be on both devices: don't double count
    return JSON.stringify(o);
  }
  function merge(cur, inc) {
    const out = Object.assign({}, cur);
    for (const [k, raw] of Object.entries(inc)) {
      if (cur[k] == null) { out[k] = raw; continue; }
      out[k] = k === PROGRESS ? mergeProgress(cur[k], raw) : k === PT ? mergePractice(cur[k], raw) : k === MISSED ? mergeMissed(cur[k], raw) : raw;
    }
    return out;
  }

  // ---- apply with backup / undo ----
  function apply(store, incoming, mode, now) {
    if (mode !== 'replace' && mode !== 'merge') fail('Unknown import mode.');
    const cur = collect(store);
    store.setItem(BACKUP, JSON.stringify({ savedAt: now || new Date().toISOString(), mode, keys: cur }));
    const next = mode === 'replace' ? Object.assign({}, incoming) : merge(cur, incoming);
    if (mode === 'replace') for (const k of Object.keys(cur)) if (KNOWN.includes(k) && !(k in next)) store.removeItem(k);
    for (const [k, v] of Object.entries(next)) store.setItem(k, v);
    return next;
  }
  function backupInfo(store) { try { const b = JSON.parse(store.getItem(BACKUP) || 'null'); return b && isObj(b.keys) ? b : null; } catch (e) { return null; } }
  function undo(store) {
    const b = backupInfo(store); if (!b) fail('There is no import to undo.');
    for (const k of Object.keys(collect(store))) store.removeItem(k);
    for (const [k, v] of Object.entries(b.keys)) store.setItem(k, v);
    store.removeItem(BACKUP);
    return b;
  }

  const api = { APP, VERSION, PREFIX, BACKUP, KNOWN, TransferError, collect, encode, decode, merge, apply, undo, backupInfo, summarize, hasGzip, fnv, b64url, unb64url };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XferCore = api;
})(typeof self !== 'undefined' ? self : this);
