'use strict';
/* ORRERY bot — the "Clockwork Familiar".
 * Used for (a) bot seats, (b) auto-play when a human's turn timer runs out, (c) seats abandoned mid-game.
 * It estimates, by Monte-Carlo sampling, how likely it is to win each House and picks the dice and slots that
 * raise the total — with a little denial (it prefers dice its opponents would want too). It only ever looks
 * at information a real player could see: public dice, its own satchel, and empty slots. */
const R = require('../public/rules.js');
const E = require('./engine');

const BOT_LOADOUT = ['tilt', 'mirror', 'wish', 'reforge'];
const SAMPLES = +(process.env.ORRERY_BOT_SAMPLES || 56);

function ctxFor(g) {
  const P = g.P, S = SAMPLES;
  const rolls = new Uint8Array(S * P * 3);
  for (let i = 0; i < rolls.length; i++) rolls[i] = 1 + Math.floor(Math.random() * 6);   // common random numbers => low-variance comparisons
  return { g, P, S, rolls, cache: new Map() };
}

/* P(win House h) for `me`, if `extra` more dice of mine are added and every other empty slot is filled randomly. */
function wp(c, me, h, extra) {
  const key = me + '|' + h + '|' + extra.slice().sort().join('');
  const hit = c.cache.get(key); if (hit !== undefined) return hit;
  const { g, P, S, rolls } = c, H = g.houses[h];
  const base = g.pids.map(p => H.slots[p].filter(Boolean).map(d => d.v));
  const mi = g.pids.indexOf(me);
  let w = 0;
  for (let i = 0; i < S; i++) {
    const hands = {};
    for (let pi = 0; pi < P; pi++) {
      const d = base[pi].slice();
      if (pi === mi) for (const v of extra) if (d.length < 3) d.push(v);
      let k = 0; while (d.length < 3) d.push(rolls[(i * P + pi) * 3 + (k++)]);
      hands[g.pids[pi]] = d;
    }
    const j = R.judge(H.law, hands);
    if (j.winner === me) w += 1;
    else if (j.tie) { const best = j.scores[j.order[0]].key; if (R.cmpKey(j.scores[me].key, best) === 0) w += 0.5; }
  }
  const r = w / S; c.cache.set(key, r); return r;
}

const openHouses = (g, pid) => g.houses.map((H, h) => ({ H, h })).filter(x => x.H.status === 'open' && x.H.slots[pid].some(d => !d));

/* how much does one die of value v improve pid's best House? */
function gain(c, pid, v) {
  let best = 0;
  for (const { h } of openHouses(c.g, pid)) best = Math.max(best, wp(c, pid, h, [v]) - wp(c, pid, h, []));
  return best;
}
function oppGain(c, me, v) {
  let m = 0; for (const p of c.g.pids) if (p !== me) m = Math.max(m, gain(c, p, v));
  return m;
}

function has(g, pid, id) { const D = g.decrees[pid]; return !D.cast && D.hand.includes(id) && !D.used.includes(id); }

function playDraft(g, pid, now, opt = {}) {
  let c = ctxFor(g);
  const score = d => gain(c, pid, d.v) + 0.35 * oppGain(c, pid, d.v) + Math.random() * 0.004;
  const rank = () => g.pool.map(d => ({ d, s: score(d) })).sort((a, b) => b.s - a.s);

  if (opt.decrees) {
    let r = rank();
    if (has(g, pid, 'reforge') && g.watch < R.WATCHES && gain(c, pid, r[0].d.v) < 0.06) {   // nothing worth taking: re-roll the worst die and look again
      if (E.cast(g, pid, { id: 'reforge', die: r[r.length - 1].d.id }, now).ok) { c = ctxFor(g); r = rank(); }
    }
    if (has(g, pid, 'wish') && g.watch >= 2) {
      let wishBest = 0;
      for (const { h } of openHouses(g, pid)) for (let v = 1; v <= 6; v++) wishBest = Math.max(wishBest, wp(c, pid, h, [v]) - wp(c, pid, h, []));
      if (wishBest - gain(c, pid, r[0].d.v) > 0.24) {
        // choose the face, and burn the die opponents want most
        let bv = 1, bg = -1;
        for (const { h } of openHouses(g, pid)) for (let v = 1; v <= 6; v++) { const x = wp(c, pid, h, [v]) - wp(c, pid, h, []); if (x > bg) { bg = x; bv = v; } }
        const burn = g.pool.slice().sort((a, b) => oppGain(c, pid, b.v) - oppGain(c, pid, a.v))[0];
        if (E.cast(g, pid, { id: 'wish', die: burn.id, v: bv }, now).ok) return;
      }
    }
  }
  const chosen = rank()[0].d;
  if (!E.pick(g, pid, chosen.id, now).ok) E.pick(g, pid, g.pool[0].id, now);
}

/* best way to drop `values` into pid's empty slots, by summed estimated win probability across Houses */
function bestArrangement(c, pid, values) {
  const g = c.g, hs = openHouses(g, pid);
  const caps = hs.map(x => x.H.slots[pid].filter(d => !d).length);
  const sel = hs.map(() => []);
  let best = { score: -1, sel: null };
  (function rec(i) {
    if (i === values.length) {
      let t = 0; for (let k = 0; k < hs.length; k++) t += wp(c, pid, hs[k].h, sel[k]);
      if (t > best.score) best = { score: t, sel: sel.map(a => a.slice()) };
      return;
    }
    for (let k = 0; k < hs.length; k++) {
      if (sel[k].length >= caps[k]) continue;
      sel[k].push(values[i]); rec(i + 1); sel[k].pop();
    }
  })(0);
  return { score: best.score, hs, sel: best.sel };
}

function toAssign(g, pid, dice, arr) {
  // map each die to a concrete slot; dice with equal values are interchangeable
  const used = dice.map(() => false), assign = [];
  arr.hs.forEach((x, k) => {
    const free = x.H.slots[pid].map((d, s) => (d ? -1 : s)).filter(s => s >= 0);
    arr.sel[k].forEach((v, n) => {
      const di = dice.findIndex((d, i) => !used[i] && d.v === v); used[di] = true;
      assign.push({ die: dice[di].id, h: x.h, s: free[n] });
    });
  });
  return assign;
}

function playArrange(g, pid, now, opt = {}) {
  const c = ctxFor(g);
  let dice = g.satchel[pid];
  let arr = bestArrangement(c, pid, dice.map(d => d.v));
  if (opt.decrees && (has(g, pid, 'tilt') || has(g, pid, 'mirror'))) {
    let bestMove = null;
    for (const d of dice) {
      const tries = [];
      if (has(g, pid, 'tilt')) { if (d.v < 6) tries.push({ id: 'tilt', dir: 1, v: d.v + 1 }); if (d.v > 1) tries.push({ id: 'tilt', dir: -1, v: d.v - 1 }); }
      if (has(g, pid, 'mirror')) tries.push({ id: 'mirror', v: 7 - d.v });
      for (const t of tries) {
        const vals = dice.map(x => (x === d ? t.v : x.v));
        const a2 = bestArrangement(c, pid, vals), gainD = a2.score - arr.score;
        if (gainD > 0.14 && (!bestMove || gainD > bestMove.gain)) bestMove = { gain: gainD, p: Object.assign({ die: d.id }, t) };
      }
    }
    if (bestMove && E.cast(g, pid, bestMove.p, now).ok) { dice = g.satchel[pid]; arr = bestArrangement(c, pid, dice.map(d => d.v)); }
  }
  const res = E.lock(g, pid, toAssign(g, pid, dice, arr), now);
  if (!res.ok) { // should never happen; fall back to the first empty slots so the game can't stall
    const slots = E.emptySlots(g, pid);
    E.lock(g, pid, dice.map((d, i) => ({ die: d.id, h: slots[i].h, s: slots[i].s })), now);
  }
}

function loadout(g, pid, random) {
  if (!random && g.bot[pid]) return BOT_LOADOUT.slice();
  return E.shuffle(R.DECREE_IDS.slice()).slice(0, R.LOADOUT);
}

module.exports = { loadout, playDraft, playArrange };
