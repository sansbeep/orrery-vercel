/* ORRERY client — renderers. Pure functions of (ui.view, ui) -> DOM. Every section is HTML-string cached, so unchanged sections never touch the DOM. */
(function () {
  'use strict';
  const OA = window.OA, ui = OA.ui, R = OA.R, OG = window.OG, FX = window.FX;
  const { $, esc, setHTML } = OA;
  const I = id => OG.icon(id);
  const icon = (id, cls) => OG.icon(id).replace('<svg ', '<svg class="' + cls + '" ');
  const LAW = id => R.LAWS[id];
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  /* ================= connection pill ================= */
  const PILL = {
    connecting: ['', 'Connecting…', 'Looking for the server…'],
    ws: ['ws', 'Live', 'Connected over WebSocket (fastest).'],
    'sio-poll': ['sio-poll', 'Live · polling', 'Socket.IO is using long-polling because your network blocks WebSocket. Everything still works.'],
    http: ['http', 'Live · HTTP', 'Connected over plain HTTP polling — works on any network, including Vercel and strict antivirus filters.'],
    reconnecting: ['bad', 'Reconnecting…', 'The connection dropped — retrying. Your seat is safe.'],
    'http-offline': ['bad', 'Offline', "Can't reach the server. Check your internet — your seat is saved."]
  };
  OA.pill = () => { const p = PILL[(ui.status || {}).mode] || PILL.connecting; return `<span class="net ${p[0]}" title="${esc(p[2])}"><i></i>${p[1]}</span>`; };

  /* ================= MENU ================= */
  OA.renderMenu = function () {
    const el = $('screen-menu');
    if (!el.__built) {
      el.__built = true;
      el.innerHTML = `<div class="hero">
        <div class="logo">${OG.logo}</div>
        <h1 class="title">ORRERY</h1>
        <p class="tag">Draft the dice. Seal your plans. Let the heavens judge.</p>
        <div id="m-warn"></div>
        <div class="card panel">
          <div class="field"><label class="lbl" for="m-name">Your name</label>
            <input id="m-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Astronomer" value="${esc(ui.name)}"></div>
          <div class="row" style="margin-top:16px"><button class="btn primary big" data-act="solo">${I('bot')} Play vs Bot</button></div>
          <div class="or">OR PLAY WITH FRIENDS</div>
          <div class="row"><button class="btn big" data-act="create">${I('plus')} Create a room</button></div>
          <div class="row" style="margin-top:12px"><input id="m-code" class="codein" type="text" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE" style="flex:1.5"><button class="btn" data-act="join">Join room</button></div>
          <div class="errline" id="m-err"></div>
        </div>
        <div class="links"><button data-act="help">How to play</button></div>
        <div class="netpill" id="m-net"></div>
      </div>`;
    }
    setHTML($('m-net'), OA.pill());
    const h = (ui.status || {}).health;
    setHTML($('m-warn'), h && h.mode === 'vercel' && !h.persistent
      ? `<div class="warnbar"><b>Heads-up:</b> this Vercel deployment has no database connected, so rooms can vanish between requests. Add a free Upstash Redis from the Vercel Marketplace (see the README) and redeploy.</div>` : '');
    const err = $('m-err'); if (err.textContent !== ui.err) err.textContent = ui.err || '';
  };

  /* ================= LOBBY ================= */
  OA.renderLobby = function () {
    const v = ui.view, me = v.you, host = OA.isHost(), t = v.settings.timer;
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const p = v.players[i];
      if (!p) { seats.push(`<div class="seat empty"><span>Open seat</span>${host ? `<button class="btn small" data-act="addbot">${I('bot')} Add bot</button>` : ''}</div>`); continue; }
      const sub = p.bot ? 'Clockwork Familiar' : p.id === v.host ? 'Host' : 'Player';
      seats.push(`<div class="seat p${i}">
        <div class="avatar p${i}">${p.bot ? I('bot') : esc(OA.initial(p.name))}${p.bot ? '' : `<span class="cd${p.connected ? '' : ' off'}"></span>`}</div>
        <div><div class="nm">${esc(p.name)}${p.id === v.host ? I('crown') : ''}${p.id === me ? `<span class="tag2 you p${i}">You</span>` : ''}${p.bot ? '<span class="tag2 bot">Bot</span>' : ''}</div>
        <div class="sub">${sub}${p.bot || p.connected ? '' : ' · away'}</div></div>
        ${host && p.id !== me ? `<button class="kick" data-act="${p.bot ? 'rmbot' : 'kick'}" data-pid="${p.id}" title="${p.bot ? 'Remove bot' : 'Remove player'}">${I('x')}</button>` : ''}
      </div>`);
    }
    const timers = [[0, 'Off'], [30, '30s'], [60, '60s'], [90, '90s'], [150, '150s']];
    const timerRow = host
      ? timers.map(([s, l]) => `<button class="btn small${t === s ? ' primary' : ''}" data-act="timer" data-s="${s}">${l}</button>`).join('')
      : `<span class="chip">${t ? t + ' seconds per pick' : 'No timer'}</span>`;
    const n = v.players.length;
    const hostName = (v.players.find(p => p.id === v.host) || {}).name || 'the host';
    setHTML($('screen-lobby'), `<div class="lobby">
      <div style="text-align:center"><div class="logo" style="width:84px;height:84px">${OG.logo}</div></div>
      <div class="codebox panel">
        <label class="lbl">Room code</label>
        <div class="big">${esc(v.code)}</div>
        <div class="row" style="justify-content:center;gap:8px"><button class="btn small" data-act="copylink" style="flex:none">${I('copy')} Copy invite link</button><button class="btn small" data-act="copycode" style="flex:none">${I('copy')} Copy code</button></div>
      </div>
      <div class="card panel" style="margin-top:14px">
        <label class="lbl">Players (${n}/4)</label>
        <div class="seats">${seats.join('')}</div>
        <label class="lbl" style="margin-top:6px">Turn timer</label>
        <div class="row" style="flex-wrap:wrap;gap:6px">${timerRow}</div>
        <div class="hint" style="margin-top:8px">Ran out of time? The autopilot plays that move for you. ${host ? '' : 'Only the host can change this.'}</div>
        <div class="lobby actions" style="width:auto">
          ${host ? `<button class="btn primary big" data-act="start" ${n < 2 ? 'disabled' : ''}>Start the game</button>` : `<div class="hint" style="flex:1;align-self:center">Waiting for <b>${esc(hostName)}</b> to start…</div>`}
          <button class="btn" data-act="help">${I('help')} How to play</button>
          <button class="btn danger" data-act="leave">${I('exit')} Leave</button>
        </div>
        ${host && n < 2 ? '<div class="hint" style="margin-top:10px">Add a bot or wait for a friend to join — you need at least two players.</div>' : ''}
      </div>
      <div style="text-align:center"><div class="netpill">${OA.pill()}</div></div>
    </div>`);
  };

  /* ================= TIMER ================= */
  OA.timerState = function () {
    const g = OA.G();
    if (!g || g.phase === 'over') return { text: '—', pct: 0, low: false, off: true };
    if (!g.deadline) return { text: '∞', pct: 0, low: false, off: true };
    const left = Math.max(0, g.deadline - (OA.net ? OA.net.serverNow() : Date.now()));
    if (ui.dlKey !== g.deadline) { ui.dlKey = g.deadline; ui.dlTotal = Math.max(1000, left); }
    return { text: mmss(Math.ceil(left / 1000)), pct: Math.min(100, left / ui.dlTotal * 100), low: left < 10000 && g.phase !== 'reveal', off: false };
  };
  OA.tickTimer = function () {
    const g = OA.G(); if (!g) return;
    const t = OA.timerState(), el = $('timer');
    if (el) {
      const tt = $('timer-t'), tb = $('timer-b');
      if (tt && tt.textContent !== t.text) tt.textContent = t.text;
      if (tb) tb.style.width = t.pct + '%';
      el.classList.toggle('low', t.low); el.classList.toggle('off', t.off);
    }
    const ov = $('ov-timer'); if (ov) ov.textContent = t.off ? 'No time limit' : t.text;
  };

  /* ================= TOP BAR ================= */
  OA.renderTop = function () {
    const v = ui.view, g = OA.G(), done = i => g.phase === 'over' || i < g.watch;
    let nodes = '';
    for (let i = 1; i <= g.watches; i++) {
      nodes += `<span class="wnode${done(i) ? ' done' : i === g.watch ? ' now' : ''}" title="Watch ${i} of ${g.watches}">${OA.ROMAN[i]}</span>`;
      if (i < g.watches) nodes += `<span class="wlink${done(i) ? ' done' : ''}"></span>`;
    }
    const PH = [['loadout', 'Decrees'], ['draft', 'Draft'], ['arrange', 'Arrange'], ['reveal', 'Reveal']];
    const cur = PH.findIndex(p => p[0] === g.phase);
    const phases = PH.map(([id, l], i) => `<span class="phase${g.phase === id ? ' now' : (g.phase === 'over' || i < cur) ? ' past' : ''}">${l}</span>`).join('');
    const t = OA.timerState();
    setHTML($('top'), `
      <div class="brand"><div class="logo">${OG.logo}</div><span>ORRERY</span></div>
      <div class="roomchip" title="Room code">${esc(v.code)}<button data-act="copylink" title="Copy invite link">${I('copy')}</button></div>
      <div class="watches">${nodes}</div>
      <div class="phases">${phases}</div>
      <div class="timer${t.low ? ' low' : ''}${t.off ? ' off' : ''}" id="timer" title="Time left for this step"><span id="timer-t">${t.text}</span><i><b id="timer-b" style="width:${t.pct}%"></b></i></div>
      ${OA.pill()}
      <button class="btn icon" data-act="mute" title="Sound on/off">${I(FX.muted ? 'mute' : 'sound')}</button>
      <button class="btn icon" data-act="help" title="How to play">${I('help')}</button>
      <button class="btn icon fab" data-act="side" title="Log, Laws &amp; chat">${I('spark')}</button>
      <button class="btn icon" data-act="leave" title="Leave game">${I('exit')}</button>`);
  };

  /* ================= PLAYER CARDS ================= */
  function stateLine(p, g) {
    const pid = p.id;
    if (p.left) return ['', I('exit'), 'Left the game'];
    if (!p.bot && !p.connected && g.phase !== 'over') return ['', I('wifi'), 'Disconnected'];
    if (g.phase === 'loadout') return g.loadoutDone[pid] ? ['good', I('check'), 'Decrees chosen'] : ['', I('spark'), 'Choosing Decrees…'];
    if (g.phase === 'draft') return g.turnPid === pid ? ['good', I('spark'), 'Picking a die…'] : ['', I('eye'), 'Waiting for turn'];
    if (g.phase === 'arrange') return g.locked[pid] ? ['good', I('lock'), 'Locked in'] : ['', I('spark'), 'Arranging dice…'];
    if (g.phase === 'reveal') return ['', I('eye'), 'Dice revealed'];
    if (g.phase === 'over') return g.result && g.result.winners.includes(pid) ? ['good', I('crown'), 'Victor'] : ['', I('check'), 'Finished'];
    return ['', '', ''];
  }
  OA.renderPlayers = function () {
    const v = ui.view, g = OA.G(), host = OA.isHost();
    const html = v.players.filter(p => p.id in g.stars).map(p => {
      const pid = p.id, pc = OA.pc(pid), me = pid === v.you;
      const dec = me ? g.decrees.mine : g.decrees.others[pid];
      let total = 0, left = 0;
      if (me && dec) { total = dec.hand.length; left = total - dec.used.length; } else if (dec) { total = g.loadoutDone[pid] ? R.LOADOUT : 0; left = dec.left; }
      let gems = ''; for (let i = 0; i < total; i++) gems += `<span class="gem${i < left ? '' : ' spent'}"></span>`;
      let stars = ''; for (let i = 0; i < R.WIN_HOUSES; i++) stars += icon('star', i < g.stars[pid] ? '' : 'off');
      const [sc, si, st] = stateLine(p, g);
      const b = ui.bubbles[pid];
      const mini = (g.satchel[pid] || []).map(d => OA.die(d.v, { cls: 'own', pid })).join('');
      const botify = host && !me && !p.bot && !p.left && !p.auto && !p.connected && g.phase !== 'over' ? `<button class="btn small" data-act="botify" data-pid="${pid}" style="margin-left:auto">Bot takes over</button>` : '';
      return `<div class="pcard panel ${pc}${g.turnPid === pid ? ' turn' : ''}">
        ${b && b.until > Date.now() ? `<div class="bubble">${esc(OA.EMO[b.id] || '…')}</div>` : ''}
        <div class="top"><div class="avatar ${pc}">${p.bot ? I('bot') : esc(OA.initial(p.name))}</div>
          <div style="min-width:0"><div class="nm"><span>${esc(p.name)}</span>${pid === v.host ? I('crown') : ''}</div>
            <div class="tags">${me ? '<span class="tag2 you">You</span>' : ''}${p.bot ? '<span class="tag2 bot">Bot</span>' : ''}${p.auto ? '<span class="tag2 bot">Autopilot</span>' : ''}${!p.bot && !p.connected && !p.left ? '<span class="tag2 afk">Away</span>' : ''}</div></div></div>
        <div class="meta"><div class="stars" title="Houses claimed (${R.WIN_HOUSES} wins) · margin ${g.margin[pid] || 0}">${stars}</div><div class="gems" title="Decrees left">${gems}</div></div>
        <div class="state ${sc}">${si}<span>${st}</span>${botify}</div>
        <div class="mini">${mini}</div>
      </div>`;
    }).join('');
    setHTML($('players'), html);
  };

  /* ================= PROMPT BAR ================= */
  const CAST_PROMPT = {
    mydie: c => c.id === 'shift' ? 'SHIFT — pick one of your revealed dice on the table' : (c.id === 'tilt' ? 'TILT' : 'MIRROR') + ' — pick one of your dice (in your Satchel or on the table)',
    dir: () => 'TILT — up or down?',
    slot: () => 'SHIFT — pick an empty slot to move it to',
    pool: c => c.id === 'wish' ? 'WISH — pick the die you want from the Well' : 'REFORGE — pick a die in the Well to re-roll',
    face: () => 'WISH — choose its face',
    oppdie: () => "HEX — pick an opponent's revealed die to re-roll",
    house: c => c.id === 'scry' ? 'SCRY — pick a House to peek into' : c.h1 == null ? 'ECLIPSE — pick the first House' : 'ECLIPSE — pick the House to swap Laws with',
    scrytarget: () => 'SCRY — whose plan do you want to see?'
  };
  OA.renderPrompt = function () {
    const g = OA.G(), el = $('prompt'), me = OA.me(), c = ui.cast;
    let msg = '', you = false, extra = '';
    if (c) {
      msg = `<span class="em">${esc(CAST_PROMPT[c.step](c))}</span>`; you = true;
      extra = `<button class="btn small" data-act="cancel">Cancel</button>`;
    } else if (g.phase === 'loadout') {
      msg = 'Choose your four Decrees to begin.';
    } else if (g.phase === 'draft') {
      if (g.turnPid === me) { you = true; msg = `<span class="em">Your pick.</span> Take a die from the Well <span class="chip">${OA.mySatchel().length + 1} of ${R.DICE_EACH}</span>`; }
      else msg = `${OA.pn(g.turnPid)} is choosing a die…` + (OA.mySatchel().length ? ' <span class="chip">you can start placing your dice</span>' : '');
    } else if (g.phase === 'arrange') {
      const sat = OA.mySatchel();
      if (OA.iLocked()) {
        const wait = Object.keys(g.locked).filter(p => !g.locked[p]);
        msg = `${I('lock').replace('<svg', '<svg style="width:16px;height:16px;display:inline;vertical-align:-3px"')} <span class="em">Plan sealed.</span> Waiting for ${wait.map(p => OA.pn(p)).join(', ') || 'the reveal'}…`;
      } else {
        const placed = sat.filter(d => ui.arr[d.id]).length;
        if (placed === sat.length && sat.length) { you = true; msg = `<span class="em">All dice placed.</span> Lock In when you're happy with your plan.`; }
        else { you = true; msg = `<span class="em">Arrange in secret.</span> Pick a die, then click a slot in any open House. <span class="chip">${placed}/${sat.length} placed</span>`; }
      }
    } else if (g.phase === 'reveal') {
      const veiled = ui.veil;
      msg = `<span class="em">REVEAL</span> — ` + (veiled || !g.reveal ? 'the heavens judge…' : g.reveal.claims.length
        ? g.reveal.claims.map(cl => `<span class="chip">${esc(LAW(g.houses[cl.h].law).name)} → ${cl.winner ? esc(OA.name(cl.winner)) : 'Eclipsed'}</span>`).join(' ') : 'no House was ready to judge.');
    } else if (g.phase === 'over') {
      const res = g.result;
      msg = res.winners.length > 1 ? '<span class="em">A draw!</span>' : `<span class="em">${esc(OA.name(res.winners[0]))} wins!</span>`;
      extra = `<button class="btn small primary" data-act="showresult">Results</button>`;
    }
    el.className = you ? 'you' : '';
    setHTML(el, msg + extra);
  };

  /* ================= BOARD ================= */
  const targetable = (where, mine) => {
    const k = ui.cast; if (!k) return false;
    if (k.step === 'mydie') return mine && (k.id === 'shift' ? where === 'board' : true);
    if (k.step === 'pool') return where === 'pool';
    if (k.step === 'oppdie') return where === 'board' && !mine;
    return false;
  };
  OA.targetable = targetable;

  function handOf(h, pid) {
    const g = OA.G(), H = g.houses[h], vals = H.slots[pid].filter(Boolean).map(d => d.v);
    let pre = false;
    if (pid === OA.me() && H.status === 'open') {
      const sat = OA.mySatchel();
      for (const id in ui.arr) if (ui.arr[id].h === h) { const d = sat.find(x => x.id === +id); if (d) { vals.push(d.v); pre = true; } }
    }
    return { vals, pre };
  }

  function slotHTML(h, s, pid, H) {
    const g = OA.G(), me = OA.me(), mine = pid === me, k = ui.cast, d = H.slots[pid][s];
    const at = `data-h="${h}" data-s="${s}"`;
    if (d) {
      const t = H.status === 'open' && targetable('board', mine);
      return `<div class="slot">${OA.die(d.v, { cls: 'own' + (t ? ' targetable' : ''), pid, attrs: `data-act="die" data-where="board" data-die="${d.id}" data-pid="${pid}" ${at}` })}</div>`;
    }
    if (mine && H.status === 'open') {
      const pd = OA.pendingAt(h, s);
      if (pd !== null) {
        const sd = OA.mySatchel().find(x => x.id === pd);
        if (sd) {
          const live = !OA.iLocked();
          const cls = 'own pending' + (live ? ' hot' : '') + (ui.sel === pd ? ' sel' : '') + (targetable('sat', true) ? ' targetable' : '');
          return `<div class="slot" data-slot="1" ${at}>${OA.die(sd.v, { cls, pid, attrs: `data-act="die" data-where="pend" data-die="${pd}" ${live ? 'draggable="true"' : ''}` })}</div>`;
        }
      }
      const place = OA.arranging() && !k && ui.sel !== null, dest = k && k.step === 'slot';
      if (place || dest) return `<div class="slot target" data-act="slot" data-slot="1" ${at}></div>`;
      if (OA.arranging()) return `<div class="slot" data-slot="1" ${at}></div>`;
    }
    return '<div class="slot"></div>';
  }

  OA.renderBoard = function () {
    const g = OA.G(), me = OA.me(), v = ui.view, k = ui.cast;
    const pl = v.players.filter(p => p.id in g.stars).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.seat - b.seat));
    const veil = ui.veil;
    const html = g.houses.map((H, h) => {
      const law = LAW(H.law), veiled = !!(veil && veil.houses.has(h));
      const status = veiled ? 'open' : H.status;
      // current standing (open Houses, using the dice everyone can see + your own pending dice)
      const hands = {}; pl.forEach(p => { hands[p.id] = handOf(h, p.id); });
      let lead = null;
      if (status === 'open' && pl.every(p => hands[p.id].vals.length)) {
        const jd = R.judge(H.law, Object.fromEntries(pl.map(p => [p.id, hands[p.id].vals]))); lead = jd.winner;
      }
      const rows = pl.map(p => {
        const pid = p.id, hd = hands[pid], rk = hd.vals.length ? law.rank(hd.vals) : null;
        const won = status === 'claimed' && H.winner === pid;
        const scry = (g.scry || []).find(x => x.watch === g.watch && x.target === pid && x.h === h);
        const scryHTML = scry && g.phase === 'arrange' ? `<div class="scry" title="Scried: how ${esc(p.name)} placed their dice here">${I('eye')}${scry.vals.map(x => x == null ? '<span class="q">?</span>' : OA.die(x, { cls: 'own', pid })).join('')}</div>` : '';
        const sc = veiled && hd.vals.length ? '<span class="sc">…</span>' : rk ? `<span class="sc${hd.pre ? ' pre' : ''}${rk.bust ? ' bust' : ''}" title="${esc(law.name)}: ${esc(rk.note || '')}">${esc(rk.label)}${rk.note && !rk.bust ? `<small>${esc(rk.note)}</small>` : ''}</span>` : '<span class="sc" style="color:var(--faint)">–</span>';
        return `<div class="prow ${OA.pc(pid)}${pid === me ? ' me' : ''}${won ? ' won' : ''}">
          <div class="ph"><span class="dot"></span><span class="pn">${esc(p.name)}</span>${lead === pid ? icon('star', 'lead') : ''}${sc}</div>
          <div class="slots">${[0, 1, 2].map(s => slotHTML(h, s, pid, H)).join('')}</div>${scryHTML}</div>`;
      }).join('');
      let ribbon = '', foot = 'Open';
      if (!veiled && H.status === 'claimed') { ribbon = `<div class="ribbon">★ ${esc(OA.name(H.winner))}</div>`; foot = 'Claimed · +' + H.margin; }
      else if (!veiled && H.status === 'eclipsed') { ribbon = '<div class="ribbon" style="--wc:#9aa0c8">ECLIPSED</div>'; foot = 'Tie — eclipsed'; }
      else if (veiled) foot = 'Judging…';
      const target = !!k && k.step === 'house' && H.status === 'open' && !(k.id === 'eclipse' && k.h1 === h);
      const wc = H.winner ? `var(--p${OA.seat(H.winner)})` : 'var(--gold)';
      return `<div class="house ${status}${target ? ' targetable' : ''}${k && k.id === 'eclipse' && k.h1 === h ? ' picked' : ''}" data-h="${h}" ${target ? 'data-act="house"' : ''} style="--h:${law.hue};--wc:${wc}">
        ${ribbon}<div class="hno">${h + 1}</div>
        <div class="head" title="${esc(law.name)} — ${esc(law.text)}"><div class="crest">${OG.law(H.law)}</div><div class="hn">${esc(law.name)}</div><div class="he">${esc(law.epithet)}</div><div class="hr">${esc(law.text)}</div></div>
        ${rows}<div class="hfoot"><div class="status">${foot}</div></div></div>`;
    }).join('');
    $('board').className = 'board n' + pl.length;
    setHTML($('board'), html);
  };

  /* ================= WELL + SATCHEL ================= */
  OA.renderWell = function () {
    const g = OA.G(), turnMe = OA.myDraftTurn(), el = $('well');
    el.className = 'panel well' + (turnMe ? ' myturn' : '');
    const order = g.phase === 'draft'
      ? `<div class="order" title="Draft order">${g.order.map((pid, i) => `<span class="oc ${OA.pc(pid)} ${i < g.turn ? 'done' : i === g.turn ? 'now' : i === g.turn + 1 ? 'next' : ''}" title="${esc(OA.name(pid))}">${i < g.turn ? I('check') : ''}</span>`).join('')}</div>` : '';
    const hot = turnMe && !ui.cast;
    const dice = g.pool.map(d => OA.die(d.v, { cls: (hot ? 'hot' : '') + (targetable('pool') ? ' targetable' : ''), attrs: `data-act="die" data-where="pool" data-die="${d.id}"` })).join('');
    const sub = g.phase === 'draft' ? (turnMe ? 'Click a die to take it.' : 'Every pick is public.') : g.phase === 'arrange' ? 'Left over — carries to the next Watch.' : '';
    setHTML(el, `<div class="ptitle">The Well <span class="hint" style="text-transform:none;letter-spacing:0;font-family:var(--ui);font-weight:500">${sub}</span>${order}</div>
      <div class="dice" id="welldice">${dice || '<span class="empty">The Well is empty.</span>'}</div>`);
  };

  OA.renderSatchel = function () {
    const g = OA.G(), sat = OA.mySatchel(), locked = OA.iLocked(), el = $('satchel');
    const placed = sat.filter(d => ui.arr[d.id]).length, all = sat.length > 0 && placed === sat.length;
    const dice = sat.map(d => {
      const isP = !!ui.arr[d.id];
      const cls = 'own' + (isP ? ' ghost' : '') + (!locked && OA.arranging() && !ui.cast ? ' hot' : '') + (ui.sel === d.id ? ' sel' : '') + (targetable('sat', true) ? ' targetable' : '');
      return OA.die(d.v, { cls, pid: OA.me(), attrs: `data-act="die" data-where="sat" data-die="${d.id}" ${!locked ? 'draggable="true"' : ''}` });
    }).join('');
    let go = '';
    if (g.phase === 'arrange' && !locked) go = `<button class="btn primary" data-act="lock" ${all ? '' : 'disabled'}>${I('lock')} Lock In</button><button class="btn small" data-act="reset" ${placed ? '' : 'disabled'} style="flex:none">Reset</button>`;
    else if (locked) go = `<span class="hint">${I('lock').replace('<svg', '<svg style="width:14px;height:14px;display:inline;vertical-align:-2px"')} Sealed. Dice stay hidden until the reveal.</span>`;
    else if (g.phase === 'draft') go = `<span class="hint">You can plan your placement now — locking opens after the draft.</span>`;
    setHTML(el, `<div class="ptitle">Your Satchel <span class="sp"></span><span class="chip">${placed}/${sat.length || R.DICE_EACH} placed</span></div>
      <div class="dice" id="satdice">${dice || '<span class="empty">Dice you draft appear here.</span>'}</div>
      ${go ? `<div class="go">${go}</div>` : ''}`);
  };

  /* ================= DECREES ================= */
  const ownDice = () => {
    const g = OA.G(), me = OA.me(), out = OA.mySatchel().slice();
    g.houses.forEach(H => { if (H.status === 'open') H.slots[me].forEach(d => { if (d) out.push(d); }); });
    return out;
  };
  OA.whyNot = function (id) {
    const g = OA.G(), me = OA.me(), D = g.decrees.mine, def = R.DECREES[id];
    if (!D || !def) return 'Unknown Decree.';
    if (D.used.includes(id)) return 'That Decree is already spent.';
    if (D.cast) return 'You may cast only one Decree per Watch.';
    if (g.phase === 'draft') {
      if (g.turnPid !== me) return 'Cast Decrees on your own draft turn (or while arranging).';
      if (def.when === 'arrange') return def.name + ' can only be cast while arranging.';
    } else if (g.phase === 'arrange') {
      if (g.locked[me]) return "You've already locked in.";
      if (def.when === 'draft') return def.name + ' can only be cast on your draft turn.';
    } else return 'Decrees are cast while drafting or arranging.';
    const open = g.houses.map((H, h) => H.status === 'open' ? h : -1).filter(h => h >= 0);
    const opp = Object.keys(g.stars).filter(p => p !== me);
    switch (id) {
      case 'tilt': case 'mirror': if (!ownDice().length) return 'You have no dice to change yet.'; break;
      case 'shift': {
        if (!open.some(h => g.houses[h].slots[me].some(Boolean))) return 'You have no revealed dice on the table yet.';
        if (!OA.myEmpty().length) return 'There is no empty slot to move to.'; break;
      }
      case 'reforge': case 'wish': if (!g.pool.length) return 'The Well is empty.'; break;
      case 'hex': if (!open.some(h => opp.some(p => g.houses[h].slots[p].some(Boolean)))) return 'No opponent has a revealed die in an open House.'; break;
      case 'eclipse': if (open.length < 2) return 'Two open Houses are needed.'; break;
      case 'scry': if (!opp.some(p => g.locked[p])) return 'No opponent has locked in yet.'; break;
    }
    return '';
  };
  OA.renderHand = function () {
    const g = OA.G(), D = g.decrees.mine, el = $('hand');
    if (!D || !D.hand.length) { setHTML(el, ''); return; }
    setHTML(el, D.hand.map(id => {
      const def = R.DECREES[id], used = D.used.includes(id), armed = ui.cast && ui.cast.id === id;
      const can = !used && !OA.whyNot(id);
      const cls = used ? 'spent' : armed ? 'armed' : can ? 'can' : 'wait';
      const when = { any: 'ANYTIME', draft: 'DRAFT TURN', arrange: 'ARRANGING' }[def.when];
      return `<div class="decree ${cls}" data-act="decree" data-id="${id}" title="${esc(def.text)}">
        <div class="g">${OG.decree(id)}</div><div><div class="dn">${esc(def.name)}<span class="when">${when}</span></div><div class="dt">${esc(def.text)}</div></div></div>`;
    }).join(''));
  };

  /* ================= SIDE RAIL ================= */
  function logLine(e) {
    const fresh = e.n > ui.freshFrom && e.n <= ui.freshTo;
    const P = OA.pn, lname = id => (LAW(id) ? LAW(id).name : id), dd = (v, pid) => OA.dd(v, pid);
    let ic = 'spark', cls = '', t = '';
    switch (e.k) {
      case 'start': ic = 'star'; cls = 'key'; t = `The Orrery turns. First to claim <b>${R.WIN_HOUSES} Houses</b> wins.`; break;
      case 'ready': ic = 'check'; t = `${P(e.p)} chose their Decrees.`; break;
      case 'watch': ic = 'spark'; cls = 'key'; t = `<b>Watch ${OA.ROMAN[e.w]}</b> — ${P(e.first)} drafts first.`; break;
      case 'pick': ic = 'check'; t = `${P(e.p)} took ${dd(e.v)}`; break;
      case 'arrange': ic = 'eye'; t = 'Draft over — arrange your dice in secret.' + (e.carry && e.carry.length ? ` ${e.carry.map(x => dd(x)).join('')} carries over.` : ''); break;
      case 'lock': ic = 'lock'; t = `${P(e.p)} locked in.`; break;
      case 'auto': ic = 'x'; t = `${P(e.p)} ran out of time — autopilot played.`; break;
      case 'left': ic = 'exit'; t = `${P(e.p)} left the game.`; break;
      case 'reveal': ic = 'eye'; cls = 'key'; t = `Watch ${OA.ROMAN[e.w]} revealed.`; break;
      case 'over': ic = 'crown'; cls = 'key'; t = e.winners.length > 1 ? 'The game ends in a <b>draw</b>.' : `<b>${esc(OA.name(e.winners[0]))}</b> wins the game!`; break;
      case 'claim': {
        ic = e.w ? 'crown' : 'x'; cls = 'key';
        const sc = Object.keys(e.scores || {}).map(p => `${esc(OA.name(p))} ${esc(e.scores[p])}`).join(' · ');
        t = (e.w ? `<b>${esc(lname(e.law))}</b> falls to ${P(e.w)}` : `<b>${esc(lname(e.law))}</b> is <b>Eclipsed</b> — exact tie`) + `<br><span style="color:var(--faint)">${sc}</span>`; break;
      }
      case 'cast': {
        ic = 'spark'; cls = 'cast'; const d = e.d, N = R.DECREES[d] ? R.DECREES[d].name.toUpperCase() : 'DECREE';
        if (d === 'tilt' || d === 'mirror') t = `${P(e.p)} cast <b>${N}</b>: ${dd(e.from, e.p)} → ${dd(e.to, e.p)}`;
        else if (d === 'shift') t = `${P(e.p)} cast <b>SHIFT</b>: moved ${dd(e.v, e.p)} to House ${e.h + 1}`;
        else if (d === 'reforge') t = `${P(e.p)} cast <b>REFORGE</b>: Well die ${dd(e.from)} → ${dd(e.to)}`;
        else if (d === 'wish') t = `${P(e.p)} cast <b>WISH</b>: took a die, ${dd(e.from)} → ${dd(e.to, e.p)}`;
        else if (d === 'hex') t = `${P(e.p)} cast <b>HEX</b> on ${P(e.target)}: ${dd(e.from)} → ${dd(e.to)} in House ${e.h + 1}`;
        else if (d === 'eclipse') t = `${P(e.p)} cast <b>ECLIPSE</b>: swapped the Laws of Houses ${e.h1 + 1} and ${e.h2 + 1}`;
        else if (d === 'scry') t = `${P(e.p)} cast <b>SCRY</b> on ${P(e.target)}'s House ${e.h + 1}`;
        else t = `${P(e.p)} cast <b>${N}</b>`;
        break;
      }
      default: return '';
    }
    return `<div class="lg ${cls}${fresh ? ' new' : ''}"><span class="ic">${I(ic)}</span><span>${t}</span></div>`;
  }
  const codex = (id, extra) => {
    const l = LAW(id);
    return `<div class="codex" style="--h:${l.hue}"><div class="crest">${OG.law(id)}</div><div><div class="cn">${esc(l.name)} <span style="color:var(--faint);font-family:var(--ui);letter-spacing:0;text-transform:none;font-weight:500">· ${esc(l.epithet)}</span></div><div class="ct">${esc(l.text)}${extra || ''}</div></div></div>`;
  };
  const decreeCodex = id => `<div class="codex" style="--h:265"><div class="decree" style="min-height:0;padding:0;border:0;background:none;gap:9px"><div class="g">${OG.decree(id)}</div><div><div class="dn">${esc(R.DECREES[id].name)}</div><div class="dt" style="font-size:11.5px">${esc(R.DECREES[id].text)}</div></div></div></div>`;
  OA.howtoHTML = function () {
    return `<div class="howto">
      <h3>The goal</h3>
      <p>Five <b>Houses</b> stand on the table, each ruled by a planet's <b>Law</b> that decides who wins it. <b>Claim ${R.WIN_HOUSES} Houses</b> to win on the spot — or, after Watch ${R.WATCHES}, have the most.</p>
      <h3>Each Watch (round)</h3>
      <ol>
        <li><b>Draft.</b> Dice are rolled into the <b>Well</b>. Take turns picking one, snake-style (A B · B A · A B). Every pick is public. You end with 3 dice. Whoever is behind drafts first.</li>
        <li><b>Arrange.</b> In secret, put your 3 dice into open slots — each House has 3 slots per player. Then <b>Lock In</b>.</li>
        <li><b>Reveal.</b> Everyone's dice flip at once. Any House where <i>every</i> player has filled all 3 slots is judged by its Law: the best hand claims it. An exact tie <b>Eclipses</b> the House — nobody wins it.</li>
      </ol>
      <p>After 5 Watches you've placed 15 dice — exactly enough to fill all five Houses. Plan ahead: a House can only be judged once everyone has finished it.</p>
      <h3>Decrees</h3>
      <p>Before the game, pick <b>4 of 8</b> secret one-use cards. You may cast <b>one per Watch</b>. Opponents can see how many you have left, never which.</p>
      ${R.DECREE_IDS.map(decreeCodex).join('')}
      <h3>The nine Laws <span style="color:var(--faint);letter-spacing:0">(5 are drawn each game)</span></h3>
      ${R.LAW_IDS.map(id => codex(id)).join('')}
      <h3>Good to know</h3>
      <p>Ties on a Law are broken by the highest die. If nobody has 3 Houses after Watch ${R.WATCHES}, most Houses wins; ties go to the bigger total margin of victory. The score beside each name shows the Law's current value for the dice on the table — it updates as you place yours.</p>
    </div>`;
  };
  OA.renderSide = function () {
    const g = OA.G(), v = ui.view;
    const tabs = [['log', 'Log'], ['laws', 'Laws'], ['rules', 'Rules']].map(([id, l]) => `<button class="tab${ui.side === id ? ' on' : ''}" data-act="tab" data-t="${id}">${l}</button>`).join('');
    let body = '';
    if (ui.side === 'log') body = g.log.slice().reverse().map(logLine).join('') || '<div class="empty">Nothing yet.</div>';
    else if (ui.side === 'laws') {
      const inPlay = g.houses.map(H => H.law);
      body = `<div class="wlabel">In play</div>${g.houses.map((H, h) => codex(H.law, ` <b style="color:var(--faint)">· House ${h + 1}</b>`)).join('')}
        <div class="wlabel">Not drawn this game</div>${R.LAW_IDS.filter(id => !inPlay.includes(id)).map(id => codex(id)).join('')}`;
    } else body = `<div class="howto" style="columns:1">${OA.howtoHTML().replace('<div class="howto">', '').replace(/<\/div>\s*$/, '')}</div>`;
    const sb = $('sidebody'), top = sb ? sb.scrollTop : 0;
    const changed = setHTML($('side'), `<div class="tabs">${tabs}</div><div class="sidebody" id="sidebody">${body}</div>
      <div><div class="wlabel" style="margin-top:0">Say something</div><div class="emotes">${Object.keys(OA.EMO).map(id => `<button data-act="emote" data-id="${id}">${esc(OA.EMO[id])}</button>`).join('')}</div></div>`);
    if (changed) { const nb = $('sidebody'); if (nb) nb.scrollTop = top; }
  };

  /* ================= OVERLAYS ================= */
  function loadoutSheet() {
    const g = OA.G(), me = OA.me(), v = ui.view, done = g.loadoutDone[me];
    const ready = v.players.filter(p => p.id in g.stars).map(p => `<span class="chip" style="${g.loadoutDone[p.id] ? 'color:var(--good);border-color:rgba(110,231,183,.4)' : ''}">${g.loadoutDone[p.id] ? I('check') : ''}${esc(p.name)}</span>`).join('');
    if (done) {
      return `<div class="sheet panel" style="width:min(620px,100%);text-align:center"><h2>Decrees sealed</h2>
        <div class="sub">Waiting for the other players to choose theirs…</div>
        <div class="readyrow" style="justify-content:center;margin-bottom:6px">${ready}</div>
        <div class="hint">Time left: <b id="ov-timer"></b></div></div>`;
    }
    const sel = ui.loadSel;
    return `<div class="sheet panel"><h2>Choose your Decrees</h2>
      <div class="sub">Pick <b>${R.LOADOUT}</b> of the 8. Each is one-use, and you may cast only one per Watch. Opponents see how many you have left — never which.</div>
      <div class="pickgrid">${R.DECREE_IDS.map(id => {
        const d = R.DECREES[id], on = sel.includes(id), when = { any: 'ANYTIME', draft: 'DRAFT TURN', arrange: 'ARRANGING' }[d.when];
        return `<div class="decree${on ? ' sel' : ''}" data-act="pickdecree" data-id="${id}"><span class="tick">${I('check')}</span><div class="g">${OG.decree(id)}</div><div class="dn">${esc(d.name)}</div><div class="when">${when}</div><div class="dt">${esc(d.text)}</div></div>`;
      }).join('')}</div>
      <div class="sheetfoot"><div class="readyrow">${ready}<span class="chip">⏱ <span id="ov-timer"></span></span></div>
        <div class="row" style="flex:none"><button class="btn" data-act="quickpick">Not sure? Quick pick</button><button class="btn primary big" data-act="loadout" ${sel.length === R.LOADOUT ? '' : 'disabled'}>Confirm ${sel.length}/${R.LOADOUT}</button></div></div></div>`;
  }
  function resultSheet() {
    const g = OA.G(), me = OA.me(), res = g.result, v = ui.view;
    const win = res.winners.includes(me), draw = res.winners.length > 1;
    const title = draw ? 'A Draw' : win ? 'Victory' : 'Defeat';
    const why = res.reason === 'majority' ? `${esc(OA.name(res.winners[0]))} claimed ${R.WIN_HOUSES} Houses.` : `After ${R.WATCHES} Watches — ${draw ? 'stars and margin are level.' : 'most Houses claimed.'}`;
    const rows = res.standings.map(s => {
      let st = ''; for (let i = 0; i < R.WIN_HOUSES; i++) st += icon('star', i < s.stars ? '' : 'off');
      return `<div class="srow${res.winners.includes(s.pid) ? ' win' : ''}"><div class="avatar ${OA.pc(s.pid)}">${OA.player(s.pid) && OA.player(s.pid).bot ? I('bot') : esc(OA.initial(OA.name(s.pid)))}</div>
        <div class="nm">${esc(OA.name(s.pid))}${s.pid === me ? ' <span class="tag2 you ' + OA.pc(s.pid) + '">You</span>' : ''}</div><div class="st">${st}</div><div class="mg">margin ${s.margin}</div></div>`;
    }).join('');
    return `<div class="sheet panel result" style="width:min(640px,100%)"><div class="rbig${win || draw ? '' : ' lose'}">${title}</div><div class="sub">${why}</div>
      <div class="stand">${rows}</div>
      <div class="sheetfoot" style="justify-content:center">
        ${OA.isHost() ? `<button class="btn primary big" data-act="again">Play again</button>` : `<span class="hint">The host can start a rematch.</span>`}
        <button class="btn" data-act="hideresult">View the board</button><button class="btn danger" data-act="leave">${I('exit')} Leave</button></div></div>`;
  }
  const helpSheet = () => `<div class="sheet panel" data-close="1"><div class="row" style="align-items:flex-start"><div><h2>How to play</h2><div class="sub">Easy to learn. Deep to master.</div></div><button class="btn icon" data-act="close" style="flex:none;margin-left:auto">${I('x')}</button></div>${OA.howtoHTML()}<div class="sheetfoot" style="justify-content:center"><button class="btn primary" data-act="close">Got it</button></div></div>`;
  const leaveSheet = () => {
    const inGame = !!OA.G() && OA.G().phase !== 'over';
    return `<div class="sheet panel" style="width:min(460px,100%);text-align:center"><h2>Leave?</h2><div class="sub">${inGame ? 'A bot will take over your seat so the others can keep playing.' : 'You can rejoin with the room code.'}</div>
      <div class="sheetfoot" style="justify-content:center"><button class="btn" data-act="close">Stay</button><button class="btn danger" data-act="leaveyes">${I('exit')} Leave</button></div></div>`;
  };
  OA.renderOverlay = function () {
    const g = OA.G(), ov = $('overlay');
    let html = '';
    if (ui.modal === 'help') html = helpSheet();
    else if (ui.modal === 'leave') html = leaveSheet();
    else if (g && g.phase === 'loadout') html = loadoutSheet();
    else if (g && g.phase === 'over' && ui.showResult && !ui.resultHidden) html = resultSheet();
    setHTML(ov, html); ov.classList.toggle('on', !!html);
    OA.tickTimer();
  };

  /* ================= master render ================= */
  OA.render = function () {
    const v = ui.view, scr = !v ? 'menu' : v.game ? 'game' : 'lobby';
    ['menu', 'lobby', 'game'].forEach(s => $('screen-' + s).classList.toggle('hidden', s !== scr));
    document.body.dataset.screen = scr;
    if (scr === 'menu') OA.renderMenu();
    else if (scr === 'lobby') OA.renderLobby();
    else {
      OA.reconcile();
      OA.renderTop(); OA.renderPlayers(); OA.renderPrompt(); OA.renderBoard(); OA.renderWell(); OA.renderSatchel(); OA.renderHand(); OA.renderSide();
    }
    OA.renderOverlay();
    if (!ui.cast && OA.hidePop) OA.hidePop();
    OA.runShots();
  };
})();
