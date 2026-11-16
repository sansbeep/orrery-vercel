/* ORRERY client — actions, input handling (click, drag & drop, keys), decree targeting, and boot. */
(function () {
  'use strict';
  const OA = window.OA, ui = OA.ui, R = OA.R, FX = window.FX, OG = window.OG, $ = OA.$, esc = OA.esc;
  const I = id => OG.icon(id);

  /* ================= networking ================= */
  const net = OA.net = new window.Net({
    state(view) {
      if (ui.leftCode && view.code === ui.leftCode) return;       // ignore stragglers from a room we just left
      if (ui.err === 'Rejoining your game…') ui.err = '';
      ui.view = view;
      if (!view.game) { try { localStorage.removeItem('orrery.arr'); } catch (e) { /* ignore */ } }
      OA.loadArr(); OA.detect(view); OA.render();
    },
    status(s) { ui.status = s; OA.render(); },
    gone(msg) { resetLocal(); ui.view = null; ui.err = msg || 'That game has ended.'; OA.render(); },
    conn(pids) { if (ui.view) { ui.view.players.forEach(p => { if (!p.bot) p.connected = pids.includes(p.id); }); OA.render(); } }
  });

  function resetLocal() {
    Object.assign(ui, { first: true, lastLogN: -1, lastRevealSeq: -1, lastWatch: 0, overSeen: false, showResult: false, resultHidden: false, arr: {}, sel: null, cast: null, loadSel: [], veil: null, modal: null, arrLoaded: '' });
    OA.hidePop(); document.body.classList.remove('side-open');
  }

  async function call(ev, data, extra) {
    const res = await net.rpc(ev, data || {}, extra);
    if (!res.ok) OA.toast(res.error || 'That did not work. Try again.', true);
    return res;
  }

  /* ---- placement memory, so a refresh doesn't lose your plan ---- */
  OA.saveArr = () => { try { const g = OA.G(); if (g) localStorage.setItem('orrery.arr', JSON.stringify({ code: ui.view.code, watch: g.watch, arr: ui.arr })); } catch (e) { /* ignore */ } };
  OA.loadArr = () => {
    const v = ui.view, g = OA.G(); if (!g || (g.phase !== 'draft' && g.phase !== 'arrange')) return;
    const key = v.code + ':' + g.watch; if (ui.arrLoaded === key) return; ui.arrLoaded = key;
    if (Object.keys(ui.arr).length) return;
    try { const o = JSON.parse(localStorage.getItem('orrery.arr') || 'null'); if (o && o.code === v.code && o.watch === g.watch && o.arr) ui.arr = o.arr; } catch (e) { /* ignore */ }
  };

  /* ================= small helpers ================= */
  function copy(text, msg) {
    const done = () => OA.toast(msg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { OA.toast('Copy failed — select the code manually.', true); }
      t.remove();
    }
  }
  const inviteLink = () => location.origin + location.pathname + '?r=' + ui.view.code;

  OA.showPop = (rect, html) => {
    OA.hidePop();
    const d = document.createElement('div'); d.className = 'pop-menu'; d.id = 'pop'; d.innerHTML = html; document.body.appendChild(d);
    const w = d.offsetWidth, h = d.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2, y = rect.top - h - 10; if (y < 8) y = rect.bottom + 10;
    d.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px'; d.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
  };
  OA.hidePop = () => { const d = $('pop'); if (d) d.remove(); };
  const dieVal = id => {
    const g = OA.G(), me = OA.me();
    let d = OA.mySatchel().find(x => x.id === id);
    if (!d) g.houses.forEach(H => H.slots[me].forEach(x => { if (x && x.id === id) d = x; }));
    return d ? d.v : 0;
  };

  /* ================= game actions ================= */
  async function pick(id) {
    OA.shot('#satchel [data-die="' + id + '"]', 'pop');
    const r = await call('pick', { die: id });
    if (r.ok) FX.sfx('pick');
  }
  function place(id, h, s) {
    if (!OA.arranging() || ui.cast) return;
    const g = OA.G(), H = g.houses[h];
    if (!H || H.status !== 'open' || H.slots[OA.me()][s]) return;
    const other = OA.pendingAt(h, s), old = ui.arr[id];
    if (other !== null && other !== id) { if (old) ui.arr[other] = { h: old.h, s: old.s }; else delete ui.arr[other]; }
    ui.arr[id] = { h, s }; ui.sel = null;
    FX.sfx('place'); OA.shot('#board [data-where="pend"][data-die="' + id + '"]', 'pop');
    OA.saveArr(); OA.render();
  }
  async function lock() {
    const sat = OA.mySatchel();
    if (sat.some(d => !ui.arr[d.id])) return OA.toast('Place all your dice first.', true);
    const r = await call('lock', { assign: sat.map(d => ({ die: d.id, h: ui.arr[d.id].h, s: ui.arr[d.id].s })) });
    if (r.ok) { FX.sfx('lock'); OA.saveArr(); }
  }

  /* ---- Decrees ---- */
  function startCast(id, rect) {
    const g = OA.G(), me = OA.me();
    ui.sel = null; OA.hidePop();
    if (id === 'tilt' || id === 'mirror' || id === 'shift') ui.cast = { id, step: 'mydie' };
    else if (id === 'reforge' || id === 'wish') ui.cast = { id, step: 'pool' };
    else if (id === 'hex') ui.cast = { id, step: 'oppdie' };
    else if (id === 'eclipse') ui.cast = { id, step: 'house', h1: null };
    else if (id === 'scry') {
      const opp = Object.keys(g.stars).filter(p => p !== me && g.locked[p]);
      if (opp.length === 1) ui.cast = { id, step: 'house', target: opp[0] };
      else {
        ui.cast = { id, step: 'scrytarget' };
        OA.showPop(rect, opp.map(p => `<button class="btn" data-act="scrytgt" data-pid="${p}"><span class="dot" style="width:9px;height:9px;border-radius:50%;background:var(--p${OA.seat(p)})"></span>${esc(OA.name(p))}</button>`).join('') + `<button class="btn small" data-act="cancel">${I('x')}</button>`);
      }
    }
    OA.render();
  }
  async function doCast(payload) {
    ui.cast = null; OA.hidePop(); OA.render();
    const r = await call('decree', payload);
    if (r.ok) FX.sfx('cast');
  }
  function castDie(el, where, id) {
    const k = ui.cast, rect = el.getBoundingClientRect();
    if (k.step === 'mydie') {
      if (k.id === 'mirror') return doCast({ id: 'mirror', die: id });
      if (k.id === 'shift') { if (where !== 'board') return OA.toast('Shift moves a revealed die on the table.', true); ui.cast = { id: 'shift', step: 'slot', die: id }; return OA.render(); }
      if (k.id === 'tilt') {
        const v = dieVal(id); ui.cast = { id: 'tilt', step: 'dir', die: id }; OA.render();
        let html = ''; if (v < 6) html += `<button class="btn" data-act="tiltdir" data-dir="1">▲ ${v} → ${v + 1}</button>`; if (v > 1) html += `<button class="btn" data-act="tiltdir" data-dir="-1">▼ ${v} → ${v - 1}</button>`;
        return OA.showPop(rect, html + `<button class="btn small" data-act="cancel">${I('x')}</button>`);
      }
    } else if (k.step === 'pool') {
      if (k.id === 'reforge') return doCast({ id: 'reforge', die: id });
      ui.cast = { id: 'wish', step: 'face', die: id }; OA.render();
      return OA.showPop(rect, [1, 2, 3, 4, 5, 6].map(n => OA.die(n, { cls: 'hot', attrs: `data-act="wishface" data-v="${n}"` })).join('') + `<button class="btn small" data-act="cancel">${I('x')}</button>`);
    } else if (k.step === 'oppdie') {
      return doCast({ id: 'hex', target: el.dataset.pid, h: +el.dataset.h, s: +el.dataset.s });
    }
  }

  /* ================= click handling ================= */
  const act = {
    /* menu */
    solo: () => enter('solo'), create: () => enter('create'), join: () => enter('join'),
    /* lobby */
    addbot: () => call('bot', {}), rmbot: el => call('bot', { remove: el.dataset.pid }), kick: el => call('kick', { pid: el.dataset.pid }),
    timer: el => call('cfg', { timer: +el.dataset.s }), start: () => { FX.unlock(); return call('start', {}); },
    copylink: () => copy(inviteLink(), 'Invite link copied!'), copycode: () => copy(ui.view.code, 'Room code copied!'),
    /* chrome */
    help: () => { ui.modal = 'help'; OA.render(); }, close: () => { ui.modal = null; OA.render(); },
    leave: () => { const g = OA.G(); if (g && g.phase !== 'over') { ui.modal = 'leave'; OA.render(); } else leave(); },
    leaveyes: () => leave(),
    mute: () => { FX.setMuted(!FX.muted); OA.render(); },
    side: () => document.body.classList.toggle('side-open'),
    tab: el => { ui.side = el.dataset.t; OA.render(); },
    emote: el => call('emote', { id: el.dataset.id }),
    botify: el => call('botify', { pid: el.dataset.pid }),
    /* loadout + results */
    pickdecree: el => { const id = el.dataset.id, i = ui.loadSel.indexOf(id); if (i >= 0) ui.loadSel.splice(i, 1); else if (ui.loadSel.length < R.LOADOUT) ui.loadSel.push(id); else OA.toast('You can bring ' + R.LOADOUT + ' Decrees — tap one to swap it out.'); FX.sfx('place'); OA.render(); },
    quickpick: () => { ui.loadSel = ['tilt', 'mirror', 'wish', 'reforge']; OA.render(); },
    loadout: async () => { const r = await call('loadout', { ids: ui.loadSel }); if (r.ok) FX.sfx('lock'); },
    again: () => call('again', {}), hideresult: () => { ui.resultHidden = true; OA.render(); }, showresult: () => { ui.resultHidden = false; ui.showResult = true; OA.render(); },
    /* the table */
    die(el) {
      FX.unlock();
      const where = el.dataset.where, id = +el.dataset.die, g = OA.G();
      if (ui.cast) return castDie(el, where, id);
      if (where === 'pool') { if (OA.myDraftTurn()) return pick(id); if (g.phase === 'draft') OA.toast("It's " + OA.name(g.turnPid) + "'s turn to draft."); return; }
      if (where === 'sat' || where === 'pend') {
        if (!OA.arranging()) return;
        if (ui.arr[id]) { delete ui.arr[id]; ui.sel = id; OA.saveArr(); } else ui.sel = ui.sel === id ? null : id;
        FX.sfx('place'); OA.render();
      }
    },
    slot(el) {
      const h = +el.dataset.h, s = +el.dataset.s, k = ui.cast;
      if (k && k.step === 'slot') return doCast({ id: 'shift', die: k.die, h, s });
      if (ui.sel !== null) place(ui.sel, h, s);
    },
    house(el) {
      const h = +el.dataset.h, k = ui.cast; if (!k || k.step !== 'house') return;
      if (k.id === 'scry') return doCast({ id: 'scry', target: k.target, h });
      if (k.h1 == null) { ui.cast = { id: 'eclipse', step: 'house', h1: h }; return OA.render(); }
      doCast({ id: 'eclipse', h1: k.h1, h2: h });
    },
    decree(el) {
      FX.unlock();
      const id = el.dataset.id, rect = el.getBoundingClientRect();
      if (ui.cast && ui.cast.id === id) return act.cancel();
      const why = OA.whyNot(id); if (why) return OA.toast(why, true);
      startCast(id, rect);
    },
    cancel() { ui.cast = null; OA.hidePop(); OA.render(); },
    tiltdir(el) { if (ui.cast && ui.cast.step === 'dir') doCast({ id: 'tilt', die: ui.cast.die, dir: +el.dataset.dir }); },
    wishface(el) { if (ui.cast && ui.cast.step === 'face') doCast({ id: 'wish', die: ui.cast.die, v: +el.dataset.v }); },
    scrytgt(el) { if (ui.cast && ui.cast.step === 'scrytarget') { ui.cast = { id: 'scry', step: 'house', target: el.dataset.pid }; OA.hidePop(); OA.render(); } },
    lock: () => lock(),
    reset: () => { ui.arr = {}; ui.sel = null; OA.saveArr(); OA.render(); }
  };

  document.addEventListener('click', e => {
    const ov = $('overlay');
    if (e.target === ov && (ui.modal === 'help' || ui.modal === 'leave')) { ui.modal = null; return OA.render(); }
    if (document.body.classList.contains('side-open') && !e.target.closest('#side') && !e.target.closest('[data-act="side"]')) document.body.classList.remove('side-open');
    const el = e.target.closest('[data-act]');
    if (!el || !act[el.dataset.act]) return;
    FX.unlock();
    const r = act[el.dataset.act](el);
    if (r && r.catch) r.catch(err => { console.error(err); OA.toast('Something went wrong.', true); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (ui.cast) act.cancel(); else if (ui.modal) { ui.modal = null; OA.render(); } }
    else if (e.key === 'Enter' && e.target && e.target.id === 'm-name') { act.solo(); }
    else if (e.key === 'Enter' && e.target && e.target.id === 'm-code') { act.join(); }
  });

  /* ---- drag & drop (mouse); touch uses tap-to-select + tap-to-place ---- */
  let dragId = null;
  const clearDrop = () => document.querySelectorAll('.drop-over').forEach(x => x.classList.remove('drop-over'));
  document.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('[data-die][draggable="true"]');
    if (!el || !OA.arranging() || ui.cast) { e.preventDefault(); return; }
    dragId = +el.dataset.die; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) { /* ignore */ }
  });
  document.addEventListener('dragover', e => {
    const s = dragId !== null && e.target.closest && e.target.closest('[data-slot]'); if (!s) return;
    e.preventDefault(); clearDrop(); s.classList.add('drop-over');
  });
  document.addEventListener('drop', e => {
    const s = dragId !== null && e.target.closest && e.target.closest('[data-slot]'); clearDrop(); if (!s) return;
    e.preventDefault(); const id = dragId; dragId = null; place(id, +s.dataset.h, +s.dataset.s);
  });
  document.addEventListener('dragend', () => { dragId = null; clearDrop(); });
  // dropping a placed die back on the Satchel un-places it
  document.addEventListener('drop', e => {
    if (dragId === null || !e.target.closest || !e.target.closest('#satchel')) return;
    e.preventDefault(); delete ui.arr[dragId]; dragId = null; OA.saveArr(); OA.render();
  });
  document.addEventListener('dragover', e => { if (dragId !== null && e.target.closest && e.target.closest('#satchel')) e.preventDefault(); });

  /* ================= menu flows ================= */
  let busy = false;
  async function enter(kind) {
    if (busy) return; busy = true; ui.err = ''; FX.unlock();
    const btns = document.querySelectorAll('#screen-menu .btn'); btns.forEach(b => { b.disabled = true; });
    try {
      const name = ($('m-name').value || '').trim(); ui.name = name; try { localStorage.setItem('orrery.name', name); } catch (e) { /* ignore */ }
      ui.leftCode = null;
      let res;
      if (kind === 'join') {
        const code = ($('m-code').value || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) { ui.err = 'Enter the 4-letter room code.'; return; }
        res = await net.rpc('join', { name }, { code });
      } else res = await net.rpc('create', { name, timer: kind === 'solo' ? 0 : 60 });
      if (!res.ok) { ui.err = res.error || 'Could not connect. Try again.'; return; }
      if (kind === 'solo') {
        const b = await net.rpc('bot', {}); if (!b.ok) { ui.err = b.error; return; }
        const s = await net.rpc('start', {}); if (!s.ok) ui.err = s.error;
      }
    } finally { busy = false; btns.forEach(b => { b.disabled = false; }); OA.render(); }
  }
  async function leave() {
    const code = ui.view && ui.view.code; ui.leftCode = code; ui.modal = null;
    try { await net.rpc('leave', {}); } catch (e) { /* ignore */ }
    net.clearSession(); resetLocal(); ui.view = null; ui.err = ''; OA.render();
  }

  /* ================= boot ================= */
  document.addEventListener('input', e => {
    if (e.target.id === 'm-name') { ui.name = e.target.value; try { localStorage.setItem('orrery.name', ui.name); } catch (err) { /* ignore */ } }
    if (e.target.id === 'm-code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Za-z]/g, '').slice(0, 4);
  });
  setInterval(() => { OA.tickTimer(); }, 250);
  setInterval(() => { if (ui.view && ui.view.game && Object.keys(ui.bubbles).length) { const now = Date.now(); let ch = false; for (const k in ui.bubbles) if (ui.bubbles[k].until < now) { delete ui.bubbles[k]; ch = true; } if (ch) OA.render(); } }, 1000);

  FX.startStars($('stars'));
  if (net.session) ui.err = 'Rejoining your game…';
  OA.render();
  const joinCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (joinCode && !net.session) { $('m-code').value = joinCode; ui.err = 'You were invited to room ' + joinCode + ' — enter a name and press Join.'; OA.render(); }
  if (!ui.view && !ui.name) { const n = $('m-name'); if (n) n.focus({ preventScroll: true }); }
  net.boot();
  window.addEventListener('beforeunload', () => { /* sessions persist in localStorage; the server keeps the seat */ });
})();
