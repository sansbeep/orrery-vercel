/* ORRERY client — core: shared state, helpers, dice, and detection of "what just happened" (sounds + animations). */
(function () {
  'use strict';
  const R = window.OrreryRules, FX = window.FX;
  const OA = window.OA = { R };
  const ui = OA.ui = {
    view: null, name: '', sel: null, arr: {}, cast: null, loadSel: [], side: 'log', modal: null, shots: [],
    lastRevealSeq: -1, lastWatch: 0, lastLogN: -1, lastChatN: -1, lastTurnKey: '', bubbles: {}, showResult: false, overSeen: false,
    resuming: false, err: '', first: true, veil: null, freshFrom: 0, freshTo: 0, resultHidden: false, leftCode: null, arrLoaded: '', pop: null, status: { mode: 'connecting', online: false }, dlKey: null, dlTotal: 1
  };
  try { ui.name = localStorage.getItem('orrery.name') || ''; } catch (e) { /* storage blocked */ }

  OA.$ = id => document.getElementById(id);
  OA.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  OA.setHTML = (el, html) => { if (!el || el.__h === html) return false; el.__h = html; el.innerHTML = html; return true; };

  /* ---- who is who ---- */
  OA.G = () => (ui.view && ui.view.game) || null;
  OA.me = () => (ui.view ? ui.view.you : null);
  OA.isHost = () => !!ui.view && ui.view.host === ui.view.you;
  OA.player = pid => (ui.view ? ui.view.players.find(p => p.id === pid) : null) || null;
  OA.seat = pid => { const i = ui.view ? ui.view.players.findIndex(p => p.id === pid) : 0; return i < 0 ? 0 : i; };
  OA.pc = pid => 'p' + OA.seat(pid);
  OA.name = pid => { const p = OA.player(pid); return p ? p.name : '?'; };
  OA.initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();
  OA.pn = pid => `<b class="pn ${OA.pc(pid)}">${OA.esc(OA.name(pid))}</b>`;

  /* ---- dice ---- */
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  OA.die = (v, o = {}) => {
    const on = PIPS[v] || [];
    let p = ''; for (let i = 0; i < 9; i++) p += '<i class="p' + (on.includes(i) ? ' on' : '') + '"></i>';
    const style = (o.pid ? '--pc:var(--p' + OA.seat(o.pid) + ');' : '') + (o.size ? '--s:' + o.size + 'px;' : '');
    return `<div class="die ${o.cls || ''}" ${o.attrs || ''} ${style ? 'style="' + style + '"' : ''} title="${v}">${p}</div>`;
  };
  OA.dd = (v, pid) => `<span class="dd${pid ? ' own ' + OA.pc(pid) : ''}">${v}</span>`;

  /* ---- grid helpers ---- */
  OA.pendingAt = (h, s) => { for (const id in ui.arr) { const a = ui.arr[id]; if (a.h === h && a.s === s) return +id; } return null; };
  OA.mySatchel = () => { const g = OA.G(); return g && g.satchel[OA.me()] ? g.satchel[OA.me()] : []; };
  OA.myDraftTurn = () => { const g = OA.G(); return !!g && g.phase === 'draft' && g.turnPid === OA.me(); };
  OA.iLocked = () => { const g = OA.G(); return !!g && !!g.locked[OA.me()]; };
  OA.arranging = () => { const g = OA.G(); return !!g && (g.phase === 'draft' || g.phase === 'arrange') && !g.locked[OA.me()] && OA.mySatchel().length > 0; };
  OA.open = h => { const g = OA.G(); return !!g && g.houses[h] && g.houses[h].status === 'open'; };
  OA.myEmpty = () => {
    const g = OA.G(), me = OA.me(), out = [];
    if (!g) return out;
    g.houses.forEach((H, h) => { if (H.status === 'open') H.slots[me].forEach((d, s) => { if (!d && OA.pendingAt(h, s) === null) out.push({ h, s }); }); });
    return out;
  };

  /* remove placements that no longer make sense (new satchel, slot taken, ...) */
  OA.reconcile = () => {
    const g = OA.G(); if (!g) { ui.arr = {}; ui.sel = null; return; }
    const ids = new Set(OA.mySatchel().map(d => d.id)), me = OA.me(), used = new Set();
    for (const id in ui.arr) {
      const a = ui.arr[id], H = g.houses[a.h], k = a.h * 10 + a.s;
      if (!ids.has(+id) || !H || H.status !== 'open' || H.slots[me][a.s] || used.has(k) || g.phase === 'reveal' || g.phase === 'over') delete ui.arr[id]; else used.add(k);
    }
    if (ui.sel !== null && !ids.has(ui.sel)) ui.sel = null;
    if (g.phase === 'arrange' && !g.locked[me] && ui.sel === null && !ui.cast) {            // while arranging, keep the next loose die ready to place
      const loose = OA.mySatchel().find(d => !ui.arr[d.id]); if (loose) ui.sel = loose.id;
    }
  };

  /* ---- feedback ---- */
  OA.toast = (msg, bad) => {
    const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = msg; OA.$('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3500); if (bad) FX.sfx('error');
  };
  OA.banner = text => {
    const d = document.createElement('div'); d.className = 'banner'; d.textContent = text; document.body.appendChild(d); setTimeout(() => d.remove(), 2300);
  };
  /* one-shot CSS animations applied right after a render, so re-renders never replay them */
  OA.shot = (sel, cls, delay) => { ui.shots.push({ sel, cls, delay: delay || 0, exp: Date.now() + 2500 }); };
  OA.runShots = () => {
    if (!ui.shots.length) return;
    const list = ui.shots; ui.shots = [];
    requestAnimationFrame(() => list.forEach(s => {
      const els = document.querySelectorAll(s.sel);
      if (!els.length) { if (Date.now() < s.exp) ui.shots.push(s); return; }      // target not rendered yet (state still in flight): try again on the next render
      els.forEach(el => {
        el.style.setProperty('--d', s.delay + 's'); el.classList.remove(s.cls); void el.offsetWidth; el.classList.add(s.cls);
        el.addEventListener('animationend', () => el.classList.remove(s.cls), { once: true });
      });
    }));
  };

  /* ---- what just happened? ---- */
  OA.detect = function (cur) {
    const g = cur.game, me = cur.you;
    // chat bubbles
    const maxChat = cur.chat.reduce((m, c) => Math.max(m, c.n), 0);
    if (ui.lastChatN < 0) ui.lastChatN = maxChat;
    for (const c of cur.chat) if (c.n > ui.lastChatN) { ui.bubbles[c.pid] = { id: c.id, until: Date.now() + 3600 }; setTimeout(() => OA.render(), 3700); FX.sfx('place'); }
    ui.lastChatN = maxChat;
    if (!g) { ui.first = false; ui.lastWatch = 0; ui.overSeen = false; ui.showResult = false; ui.resultHidden = false; ui.veil = null; ui.arr = {}; ui.arrLoaded = ''; ui.lastRevealSeq = -1; ui.lastLogN = -1; return; }

    const baseline = ui.first || ui.lastLogN < 0;
    const maxLog = g.log.reduce((m, e) => Math.max(m, e.n), 0);
    if (baseline) {
      ui.lastLogN = maxLog; ui.freshFrom = ui.freshTo = maxLog; ui.lastRevealSeq = g.reveal ? g.reveal.seq : 0; ui.lastWatch = g.watch; ui.first = false;
      ui.lastTurnKey = g.watch + ':' + g.turn; if (g.phase === 'over') { ui.overSeen = true; ui.showResult = true; }
      return;
    }

    // new Watch: the dice tumble into the Well
    if (g.watch !== ui.lastWatch && g.phase === 'draft') {
      ui.lastWatch = g.watch; ui.arr = {}; ui.sel = null; ui.cast = null;
      FX.sfx('roll'); if (g.watch > 1) OA.banner('WATCH ' + ['', 'I', 'II', 'III', 'IV', 'V'][g.watch]);
      g.pool.forEach((d, i) => OA.shot('#well [data-die="' + d.id + '"]', 'tumble', i * 0.06));
    }
    // log-driven sounds
    for (const e of g.log) {
      if (e.n <= ui.lastLogN) continue;
      if (e.k === 'pick' && e.p !== me) FX.sfx('pick');
      else if (e.k === 'cast') { FX.sfx('cast'); if (e.p !== me) OA.toast(OA.name(e.p) + ' cast ' + (R.DECREES[e.d] ? R.DECREES[e.d].name.toUpperCase() : 'a Decree') + '!'); if (e.d === 'hex' && e.target === me) OA.shot('.die[data-pid="' + me + '"][data-h="' + e.h + '"][data-s="' + e.s + '"]', 'shake'); }
      else if (e.k === 'lock' && e.p !== me) FX.sfx('lock');
      else if (e.k === 'auto' && e.p === me) OA.toast('Time ran out — the autopilot played for you.', true);
      else if (e.k === 'left') OA.toast(OA.name(e.p) + ' left the game.');
    }
    ui.freshFrom = ui.lastLogN; ui.freshTo = maxLog; ui.lastLogN = maxLog;

    // reveal: every die flips at once, then (after a short veil) the verdicts land
    if (g.reveal && g.reveal.seq > ui.lastRevealSeq) {
      ui.lastRevealSeq = g.reveal.seq;
      g.reveal.items.forEach((it, i) => OA.shot('#board [data-die="' + it.id + '"]', 'flip', i * 0.085));
      FX.sfx('reveal'); OA.banner('REVEAL');
      const claims = g.reveal.claims, t = 750 + g.reveal.items.length * 85;
      if (claims.length) {
        const veil = ui.veil = { houses: new Set(claims.map(c => c.h)) };
        setTimeout(() => {
          if (ui.veil !== veil) return;
          ui.veil = null;
          claims.forEach((c, i) => { OA.shot('#board .house[data-h="' + c.h + '"] .ribbon', 'stamp', i * 0.3); setTimeout(() => FX.sfx(c.winner ? 'claim' : 'eclipse'), i * 300 + 120); });
          OA.render();
        }, t);
      }
    }
    // my draft turn
    const key = g.watch + ':' + g.turn;
    if (g.phase === 'draft' && g.turnPid === me && key !== ui.lastTurnKey) FX.sfx('turn');
    ui.lastTurnKey = key;
    // the end
    if (g.phase === 'over' && !ui.overSeen) {
      ui.overSeen = true;
      const win = g.result && g.result.winners.includes(me);
      setTimeout(() => { ui.showResult = true; FX.sfx(win ? 'win' : 'lose'); OA.render(); }, g.reveal ? 3300 : 400);
    }
  };

  OA.EMO = { hello: 'Hello!', wow: 'Wow!', hmm: 'Hmm…', gg: 'GG', oops: 'Oops!', nice: 'Nice one!', hurry: 'Hurry up!', thanks: 'Thanks!' };
  OA.ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
})();
