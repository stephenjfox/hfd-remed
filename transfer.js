/* "Transfer progress" panel (#x-transfer): export all hfdqbank.* localStorage as a text code, import it on
   another device (preview, then Replace or Merge), with an automatic backup and "Undo last import".
   Uses app globals (esc, mathify) at call time; the packing logic lives in transfer-core.js (XferCore). */
(function () {
  const X = window.XferCore, MSG = 'hfdxfer.msg';
  const $ = id => document.getElementById(id);
  let pending = null; // decoded import awaiting Replace/Merge
  const when = iso => { const d = new Date(iso); return isNaN(d) ? 'unknown date' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const sumLine = s => `<b class="mono">${s.answered}</b> questions answered · <b class="mono">${s.tests}</b> practice test${s.tests === 1 ? '' : 's'} saved${s.inProgress ? ' (+1 in progress)' : ''} · ${s.flagged} flagged · ${s.savedSplits} saved split${s.savedSplits === 1 ? '' : 's'} · ${s.testMissed} test-missed`;
  const kb = n => n < 1024 ? `${n} characters` : `${(n / 1024).toFixed(1)} K characters`;

  function render() {
    const s = X.summarize(X.collect(localStorage)), b = X.backupInfo(localStorage), msg = sessionStorage.getItem(MSG);
    sessionStorage.removeItem(MSG); pending = null;
    $('app').innerHTML = `<div class="pt xf">
<div class="kicker">Move your progress between devices · works offline</div><h1>Transfer progress</h1>
${msg ? `<div class="box xf-ok">${esc(msg)}</div>` : ''}
<div class="box"><h3>On this device</h3><div class="muted">${sumLine(s)}</div></div>
<div class="box"><h3>1 · Export from this device</h3>
<p class="muted">Makes a text code holding your answers, flags, practice tests, saved splits, test-missed list and theme. Copy or share it, then paste it into <b>Import</b> on your other device.</p>
<label class="pt-chk"><input type="checkbox" id="xf-gz" ${X.hasGzip() ? 'checked' : 'disabled'}><span>Compress (shorter code)${X.hasGzip() ? '' : ' <span class="muted">— not supported in this browser</span>'}</span></label>
<div class="pt-actions"><button class="pri" id="xf-export">Create transfer code</button></div>
<div id="xf-out" hidden><textarea id="xf-code" class="xf-code mono" readonly rows="6" spellcheck="false" aria-label="Transfer code"></textarea>
<div class="muted" id="xf-size"></div>
<div class="pt-actions"><button class="pri" id="xf-copy">Copy</button>${navigator.share ? '<button id="xf-share">Share…</button>' : ''}<span class="muted" id="xf-copied"></span></div></div></div>
<div class="box"><h3>2 · Import onto this device</h3>
<p class="muted">Paste a code made on your other device. Nothing changes until you choose Replace or Merge, and your current progress is backed up first.</p>
<textarea id="xf-in" class="xf-code mono" rows="5" spellcheck="false" placeholder="HFD1.z.…" aria-label="Paste transfer code"></textarea>
<div class="pt-actions"><button class="pri" id="xf-check">Check code</button><button id="xf-clear">Clear</button></div>
<div id="xf-err" class="xf-err" role="alert" hidden></div><div id="xf-prev" hidden></div></div>
${b ? `<div class="box"><h3>Undo</h3><p class="muted">Your progress from before the last import (${when(b.savedAt)}, ${esc(b.mode || 'import')}) is kept as a backup: ${sumLine(X.summarize(b.keys))}.</p><button id="xf-undo">Undo last import</button></div>` : ''}
</div>`;
    $('xf-export').onclick = doExport;
    $('xf-check').onclick = check;
    $('xf-clear').onclick = () => { $('xf-in').value = ''; $('xf-err').hidden = true; $('xf-prev').hidden = true; pending = null; };
    if (b) $('xf-undo').onclick = () => {
      if (!confirm('Restore your progress from before the last import? Anything done since then is lost.')) return;
      try { X.undo(localStorage); done('Undid the last import. Your earlier progress is back.'); } catch (e) { showErr(e); }
    };
  }

  async function doExport() {
    const btn = $('xf-export'); btn.disabled = true;
    try {
      const code = await X.encode(X.collect(localStorage), { gzip: $('xf-gz').checked });
      $('xf-code').value = code; $('xf-out').hidden = false;
      $('xf-size').textContent = `${kb(code.length)} · ${code.split('.')[1] === 'z' ? 'compressed' : 'uncompressed'} · made ${when(new Date().toISOString())}`;
      $('xf-copy').onclick = () => copy(code);
      if ($('xf-share')) $('xf-share').onclick = () => navigator.share({ title: 'HFD Qbank progress', text: code }).catch(() => {});
    } catch (e) { alert('Could not create a code: ' + e.message); } finally { btn.disabled = false; }
  }
  async function copy(code) {
    const t = $('xf-code'), note = $('xf-copied');
    try { await navigator.clipboard.writeText(code); note.textContent = '✓ Copied'; }
    catch (e) { t.focus(); t.select(); t.setSelectionRange(0, code.length); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} note.textContent = ok ? '✓ Copied' : 'Selected — copy it from the box'; }
  }
  function showErr(e) { const el = $('xf-err'); el.textContent = '✗ ' + (e && e.message ? e.message : String(e)); el.hidden = false; $('xf-prev').hidden = true; pending = null; }
  async function check() {
    $('xf-err').hidden = true; $('xf-prev').hidden = true; pending = null;
    let r; try { r = await X.decode($('xf-in').value); } catch (e) { return showErr(e); }
    pending = r;
    const here = X.summarize(X.collect(localStorage));
    const el = $('xf-prev'); el.hidden = false;
    el.innerHTML = `<div class="box xf-ok"><div><b>✓ Valid code</b> · exported ${esc(when(r.exportedAt))}${r.compressed ? '' : ' · uncompressed'}</div>
<div style="margin-top:6px">Code: ${sumLine(r.summary)}</div><div class="muted">This device now: ${sumLine(here)}</div>
${r.ignored.length ? `<div class="muted">Ignored unknown items: ${r.ignored.map(esc).join(', ')}</div>` : ''}</div>
<div class="pt-actions"><button class="pri" id="xf-merge">Merge</button><button id="xf-replace">Replace</button></div>
<div class="muted"><b>Merge</b> keeps everything from both devices: answers to questions answered on only one side are kept; for a question answered on both, the more recent answer wins (the code's answer if either side has no time stamp); practice tests, saved splits and test-missed lists are combined. <b>Replace</b> makes this device an exact copy of the code.</div>`;
    $('xf-merge').onclick = () => go('merge');
    $('xf-replace').onclick = () => { if (confirm('Replace ALL progress on this device with the code? (A backup is kept; you can undo.)')) go('replace'); };
  }
  function go(mode) {
    if (!pending) return;
    try { X.apply(localStorage, pending.keys, mode); }
    catch (e) { return showErr(e); }
    done(mode === 'merge' ? 'Merged the code into this device. A backup of the previous state was saved.' : 'Replaced this device’s progress with the code. A backup of the previous state was saved.');
  }
  function done(msg) { sessionStorage.setItem(MSG, msg); location.hash = '#x-transfer'; location.reload(); }

  window.XFER = { render, _check: check };
})();
