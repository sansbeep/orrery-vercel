'use strict';
/* ORRERY rules engine — pure, synchronous, JSON-serialisable state.
 *
 * A game is 5 Watches. Each Watch:
 *   DRAFT    players take turns (snake order) drafting 3 dice each from the shared Well. Picks are public.
 *   ARRANGE  everyone secretly slots their 3 dice into empty slots across the Houses, then locks in.
 *   REVEAL   all dice flip at once; any House that is full for every player is judged by its Law.
 * First to claim 3 Houses wins (or most Houses after Watch 5).
 */
const R = require('../public/rules.js');

const REVEAL_MS = +(process.env.ORRERY_REVEAL_MS || 4800);
const LOG_MAX = 90;

const rnd = n => Math.floor(Math.random() * n);
const roll = () => 1 + rnd(6);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const err = error => ({ ok: false, error });
const ok = (extra) => Object.assign({ ok: true }, extra);
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

function log(g, e) { e.n = ++g.logSeq; g.log.push(e); if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX); }
function setDeadline(g, now, secs) { g.deadline = secs > 0 ? now + Math.round(secs * 1000) : null; }

function newGame(pids, opts = {}) {
  const now = opts.now || Date.now();
  const by = f => Object.fromEntries(pids.map(p => [p, f(p)]));
  const laws = shuffle(R.LAW_IDS.slice()).slice(0, R.HOUSES);
  const g = {
    pids: pids.slice(), P: pids.length, timer: opts.timer | 0,
    bot: by(p => !!(opts.bots && opts.bots.includes(p))), auto: by(() => 0),
    watch: 0, phase: 'loadout',
    houses: laws.map(law => ({ law, status: 'open', winner: null, margin: 0, slots: by(() => [null, null, null]) })),
    pool: [], order: [], turn: 0,
    satchel: by(() => []), alloc: by(() => ({ locked: false, map: {} })),
    decrees: by(() => ({ hand: [], used: [], cast: false })), loadout: by(() => null),
    stars: by(() => 0), margin: by(() => 0), scry: by(() => []),
    nextId: 1, log: [], logSeq: 0, revealSeq: 0, lastReveal: null,
    deadline: null, result: null, started: now
  };
  setDeadline(g, now, g.timer ? Math.max(60, g.timer * 1.5) : 0);
  log(g, { k: 'start' });
  return g;
}

/* ---------- loadout ---------- */
function setLoadout(g, pid, ids, now) {
  if (g.phase !== 'loadout') return err('Loadout is over.');
  if (g.loadout[pid]) return err('You already confirmed your Decrees.');
  if (!Array.isArray(ids) || ids.length !== R.LOADOUT) return err('Choose exactly ' + R.LOADOUT + ' Decrees.');
  const set = new Set(ids);
  if (set.size !== ids.length || ids.some(i => !R.DECREES[i])) return err('Invalid Decree choice.');
  g.loadout[pid] = ids.slice();
  g.decrees[pid].hand = ids.slice();
  log(g, { k: 'ready', p: pid });
  if (g.pids.every(p => g.loadout[p])) startWatch(g, now);
  return ok();
}

/* ---------- watch flow ---------- */
function startWatch(g, now) {
  g.watch += 1;
  const need = R.DICE_EACH * g.P + 1;
  while (g.pool.length < need) g.pool.push({ id: g.nextId++, v: roll() });
  let start;
  if (g.watch === 1) start = g.pids[rnd(g.P)];
  else {
    // catch-up rule: whoever has claimed the fewest Houses drafts first; ties rotate from last Watch's final pick
    const min = Math.min(...g.pids.map(p => g.stars[p]));
    const from = g.pids.indexOf(g.order[g.order.length - 1]);
    for (let k = 0; k < g.P; k++) { const p = g.pids[(from + k) % g.P]; if (g.stars[p] === min) { start = p; break; } }
  }
  const si = g.pids.indexOf(start);
  g.order = R.snake(g.pids.map((_, k) => g.pids[(si + k) % g.P]));
  g.turn = 0; g.phase = 'draft';
  for (const p of g.pids) { g.satchel[p] = []; g.alloc[p] = { locked: false, map: {} }; g.decrees[p].cast = false; g.scry[p] = []; }
  setDeadline(g, now, g.timer);
  log(g, { k: 'watch', w: g.watch, first: start });
}

function takeDie(g, pid, idx, v, now) {
  const [die] = g.pool.splice(idx, 1);
  if (v) die.v = v;
  g.satchel[pid].push(die);
  g.turn += 1;
  if (g.turn >= g.order.length) {
    g.phase = 'arrange';
    setDeadline(g, now, g.timer * 2);
    log(g, { k: 'arrange', carry: g.pool.map(d => d.v) });
  } else setDeadline(g, now, g.timer);
  return die;
}

function pick(g, pid, dieId, now) {
  if (g.phase !== 'draft') return err('Not drafting right now.');
  if (g.order[g.turn] !== pid) return err("It isn't your turn to draft.");
  const idx = g.pool.findIndex(d => d.id === dieId);
  if (idx < 0) return err('That die is no longer in the Well.');
  const die = takeDie(g, pid, idx, 0, now);
  log(g, { k: 'pick', p: pid, v: die.v });
  return ok();
}

/* where is one of this player's dice? returns { die, where:'satchel'|'board', h, s } or null */
function findOwn(g, pid, dieId) {
  const sd = g.satchel[pid].find(d => d.id === dieId);
  if (sd) return { die: sd, where: 'satchel' };
  for (let h = 0; h < g.houses.length; h++) {
    const arr = g.houses[h].slots[pid];
    for (let s = 0; s < arr.length; s++) if (arr[s] && arr[s].id === dieId) return { die: arr[s], where: 'board', h, s };
  }
  return null;
}

/* ---------- decrees ---------- */
function cast(g, pid, p, now) {
  if (!p || typeof p !== 'object') return err('Bad Decree.');
  if (g.phase !== 'draft' && g.phase !== 'arrange') return err('You can only cast Decrees while drafting or arranging.');
  const D = g.decrees[pid], def = R.DECREES[p.id];
  if (!def || !D.hand.includes(p.id)) return err("That Decree isn't in your hand.");
  if (D.used.includes(p.id)) return err('That Decree is already spent.');
  if (D.cast) return err('You may cast only one Decree per Watch.');
  if (g.phase === 'draft') {
    if (g.order[g.turn] !== pid) return err('Cast Decrees on your own draft turn.');
    if (def.when === 'arrange') return err(def.name + ' can only be cast while arranging.');
  } else {
    if (def.when === 'draft') return err(def.name + ' can only be cast on your draft turn.');
    if (g.alloc[pid].locked) return err("You've already locked in.");
  }
  const open = h => g.houses[h] && g.houses[h].status === 'open';
  let entry;

  switch (p.id) {
    case 'tilt': case 'mirror': {
      const f = findOwn(g, pid, p.die);
      if (!f) return err('Pick one of your own dice.');
      if (f.where === 'board' && !open(f.h)) return err('That House is already claimed.');
      const from = f.die.v;
      if (p.id === 'tilt') {
        if (p.dir !== 1 && p.dir !== -1) return err('Tilt up or down.');
        const to = from + p.dir; if (to < 1 || to > 6) return err("A die can't go past that face.");
        f.die.v = to;
      } else f.die.v = 7 - from;
      entry = { die: f.die.id, from, to: f.die.v, h: f.h, where: f.where };
      break;
    }
    case 'shift': {
      const f = findOwn(g, pid, p.die);
      if (!f || f.where !== 'board') return err('Pick one of your revealed dice on the table.');
      if (!open(f.h)) return err('That House is already claimed.');
      if (!isInt(p.h, 0, R.HOUSES - 1) || !isInt(p.s, 0, R.SLOTS - 1)) return err('Pick a destination slot.');
      if (!open(p.h)) return err('That House is already claimed.');
      if (g.houses[p.h].slots[pid][p.s]) return err('That slot is taken.');
      g.houses[f.h].slots[pid][f.s] = null; g.houses[p.h].slots[pid][p.s] = f.die;
      entry = { die: f.die.id, v: f.die.v, from: f.h, h: p.h };
      break;
    }
    case 'reforge': {
      const d = g.pool.find(x => x.id === p.die);
      if (!d) return err('Pick a die in the Well.');
      const from = d.v; d.v = roll();
      entry = { die: d.id, from, to: d.v };
      break;
    }
    case 'wish': {
      const idx = g.pool.findIndex(x => x.id === p.die);
      if (idx < 0) return err('Pick a die in the Well.');
      if (!isInt(p.v, 1, 6)) return err('Choose a face from 1 to 6.');
      const from = g.pool[idx].v;
      D.cast = true; D.used.push('wish');
      takeDie(g, pid, idx, p.v, now);
      log(g, { k: 'cast', p: pid, d: 'wish', from, to: p.v });
      return ok();
    }
    case 'hex': {
      if (!g.pids.includes(p.target) || p.target === pid) return err('Pick an opponent.');
      if (!isInt(p.h, 0, R.HOUSES - 1) || !isInt(p.s, 0, R.SLOTS - 1)) return err('Pick a die.');
      if (!open(p.h)) return err('That House is already claimed.');
      const die = g.houses[p.h].slots[p.target][p.s];
      if (!die) return err('There is no die in that slot.');
      const from = die.v; die.v = roll();
      entry = { target: p.target, h: p.h, s: p.s, from, to: die.v };
      break;
    }
    case 'eclipse': {
      if (!isInt(p.h1, 0, R.HOUSES - 1) || !isInt(p.h2, 0, R.HOUSES - 1) || p.h1 === p.h2) return err('Pick two different Houses.');
      if (!open(p.h1) || !open(p.h2)) return err('Both Houses must be unclaimed.');
      const a = g.houses[p.h1], b = g.houses[p.h2], t = a.law; a.law = b.law; b.law = t;
      entry = { h1: p.h1, h2: p.h2, l1: a.law, l2: b.law };
      break;
    }
    case 'scry': {
      if (!g.pids.includes(p.target) || p.target === pid) return err('Pick an opponent.');
      if (!g.alloc[p.target].locked) return err("They haven't locked in yet.");
      if (!isInt(p.h, 0, R.HOUSES - 1)) return err('Pick a House.');
      const vals = [null, null, null];
      for (const d of g.satchel[p.target]) { const a = g.alloc[p.target].map[d.id]; if (a && a.h === p.h) vals[a.s] = d.v; }
      g.scry[pid].push({ watch: g.watch, target: p.target, h: p.h, vals });
      entry = { target: p.target, h: p.h };
      break;
    }
    default: return err('Unknown Decree.');
  }
  D.cast = true; D.used.push(p.id);
  log(g, Object.assign({ k: 'cast', p: pid, d: p.id }, entry));
  return ok();
}

/* ---------- arrange / lock / reveal ---------- */
function emptySlots(g, pid) {
  const out = [];
  g.houses.forEach((H, h) => { if (H.status !== 'open') return; H.slots[pid].forEach((d, s) => { if (!d) out.push({ h, s }); }); });
  return out;
}

function lock(g, pid, assign, now) {
  if (g.phase !== 'arrange') return err("It isn't time to lock in yet.");
  if (g.alloc[pid].locked) return err('Already locked in.');
  const sat = g.satchel[pid];
  if (!Array.isArray(assign) || assign.length !== sat.length) return err('Place all of your dice first.');
  const map = {}, dice = new Set(), slots = new Set();
  for (const a of assign) {
    if (!a || !sat.some(d => d.id === a.die) || dice.has(a.die)) return err('Unknown die.');
    if (!isInt(a.h, 0, R.HOUSES - 1) || !isInt(a.s, 0, R.SLOTS - 1)) return err('Bad slot.');
    if (g.houses[a.h].status !== 'open') return err('A House you picked is already claimed.');
    if (g.houses[a.h].slots[pid][a.s]) return err('That slot is already filled.');
    const key = a.h * 10 + a.s; if (slots.has(key)) return err('Two dice share a slot.');
    dice.add(a.die); slots.add(key); map[a.die] = { h: a.h, s: a.s };
  }
  g.alloc[pid] = { locked: true, map };
  log(g, { k: 'lock', p: pid });
  if (g.pids.every(p => g.alloc[p].locked)) reveal(g, now);
  return ok();
}

function reveal(g, now) {
  const items = [];
  for (const p of g.pids) {
    for (const die of g.satchel[p]) {
      const a = g.alloc[p].map[die.id];
      g.houses[a.h].slots[p][a.s] = die;
      items.push({ pid: p, h: a.h, s: a.s, id: die.id, v: die.v });
    }
    g.satchel[p] = [];
  }
  g.revealSeq += 1;
  const claims = [];
  g.houses.forEach((H, h) => {
    if (H.status !== 'open' || !g.pids.every(p => H.slots[p].every(Boolean))) return;
    const hands = Object.fromEntries(g.pids.map(p => [p, H.slots[p].map(d => d.v)]));
    const j = R.judge(H.law, hands);
    const scores = Object.fromEntries(g.pids.map(p => [p, j.scores[p].label]));
    if (j.winner) { H.status = 'claimed'; H.winner = j.winner; H.margin = j.margin; g.stars[j.winner] += 1; g.margin[j.winner] += j.margin; }
    else H.status = 'eclipsed';
    claims.push({ h, winner: j.winner, scores });
    log(g, { k: 'claim', h, law: H.law, w: j.winner, scores });
  });
  g.lastReveal = { seq: g.revealSeq, watch: g.watch, items, claims };
  log(g, { k: 'reveal', w: g.watch });
  const lead = Math.max(...g.pids.map(p => g.stars[p]));
  if (lead >= R.WIN_HOUSES || g.watch >= R.WATCHES) finish(g, lead >= R.WIN_HOUSES ? 'majority' : 'final');
  else { g.phase = 'reveal'; g.deadline = now + REVEAL_MS; }
}

function finish(g, reason) {
  const st = g.pids.map(p => ({ pid: p, stars: g.stars[p], margin: g.margin[p] }))
    .sort((a, b) => b.stars - a.stars || b.margin - a.margin);
  const winners = st.filter(x => x.stars === st[0].stars && x.margin === st[0].margin).map(x => x.pid);
  g.phase = 'over'; g.deadline = null;
  g.result = { winners, standings: st, reason };
  log(g, { k: 'over', winners });
}

/* ---------- time + bots ---------- */
function tick(g, now) {
  if (!g || !g.deadline || now < g.deadline) return false;
  const bot = require('./bot');
  if (g.phase === 'loadout') {
    for (const p of g.pids) if (!g.loadout[p]) { g.auto[p]++; setLoadout(g, p, bot.loadout(g, p, true), now); }
  } else if (g.phase === 'draft') {
    const p = g.order[g.turn]; g.auto[p]++; log(g, { k: 'auto', p });
    bot.playDraft(g, p, now, { decrees: false });
  } else if (g.phase === 'arrange') {
    for (const p of g.pids) if (!g.alloc[p].locked) { g.auto[p]++; log(g, { k: 'auto', p }); bot.playArrange(g, p, now, { decrees: false }); if (g.phase !== 'arrange') break; }
  } else if (g.phase === 'reveal') startWatch(g, now);
  else g.deadline = null;
  return true;
}

function settle(g, now) {
  if (!g) return;
  const bot = require('./bot');
  for (let guard = 0; guard < 400; guard++) {
    let acted = false;
    if (g.phase === 'loadout') {
      for (const p of g.pids) if (g.bot[p] && !g.loadout[p]) { setLoadout(g, p, bot.loadout(g, p), now); acted = true; break; }
    } else if (g.phase === 'draft') {
      const p = g.order[g.turn];
      if (g.bot[p]) { bot.playDraft(g, p, now, { decrees: true }); acted = true; }
    } else if (g.phase === 'arrange') {
      for (const p of g.pids) if (g.bot[p] && !g.alloc[p].locked) { bot.playArrange(g, p, now, { decrees: true }); acted = true; break; }
    }
    if (!acted) break;
  }
}

/* ---------- what a given player is allowed to see ---------- */
function publicView(g, me) {
  const others = {};
  for (const p of g.pids) if (p !== me) others[p] = { left: g.decrees[p].hand.length - g.decrees[p].used.length, cast: g.decrees[p].cast, ready: !!g.loadout[p] };
  return {
    watch: g.watch, watches: R.WATCHES, phase: g.phase, order: g.order, turn: g.turn,
    turnPid: g.phase === 'draft' ? g.order[g.turn] : null,
    deadline: g.deadline, timer: g.timer,
    houses: g.houses.map(H => ({ law: H.law, status: H.status, winner: H.winner, margin: H.margin, slots: H.slots })),
    pool: g.pool, satchel: g.satchel,
    locked: Object.fromEntries(g.pids.map(p => [p, g.alloc[p].locked])),
    stars: g.stars, margin: g.margin, bot: g.bot, auto: g.auto,
    decrees: {
      mine: g.decrees[me] || null, others,
      played: Object.fromEntries(g.pids.map(p => [p, g.decrees[p].used]))
    },
    loadoutDone: Object.fromEntries(g.pids.map(p => [p, !!g.loadout[p]])),
    scry: g.scry[me] || [],
    reveal: g.lastReveal, log: g.log.slice(-60), result: g.result
  };
}

module.exports = { REVEAL_MS, newGame, setLoadout, pick, cast, lock, tick, settle, publicView, emptySlots, findOwn, startWatch, reveal, roll, shuffle };
