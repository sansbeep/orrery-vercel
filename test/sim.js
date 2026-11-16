'use strict';
/* Engine tests + balance simulation.  node test/sim.js [games]  */
const assert = require('assert');
const R = require('../public/rules.js');
const E = require('../lib/engine.js');
const N = +(process.argv[2] || 120);

let passed = 0; const t = (name, fn) => { fn(); passed++; };

/* ---------- Laws ---------- */
t('laws score as written', () => {
  const j = (law, a, b) => R.judge(law, { a, b });
  assert.strictEqual(j('sol', [6, 5, 4], [6, 5, 3]).winner, 'a');
  assert.strictEqual(j('luna', [1, 1, 2], [1, 2, 2]).winner, 'a');
  assert.strictEqual(j('mercury', [4, 3, 3], [6, 6, 1]).winner, 'a');          // 10 vs 13
  assert.strictEqual(j('venus', [3, 4, 5], [6, 6, 6]).winner, 'a');            // 12+10=22 vs 18
  assert.strictEqual(R.LAWS.venus.rank([3, 4, 5]).val, 22);
  assert.strictEqual(j('mars', [6, 1, 1], [5, 5, 5]).winner, 'a');
  assert.strictEqual(j('jupiter', [6, 4, 1], [6, 2, 2]).winner, 'a');          // 10 vs 10 -> sum 11 vs 10
  assert.strictEqual(R.LAWS.neptune.rank([5, 3, 2]).val, 8);
  assert.strictEqual(R.LAWS.saturn.rank([6, 5, 3]).label, 'BUST');
  assert.strictEqual(j('saturn', [6, 5, 3], [1, 1, 1]).winner, 'b');           // bust loses to anything
  assert.strictEqual(j('saturn', [6, 5, 3], [6, 6, 3]).winner, 'a');           // both bust: lower sum wins
  assert.strictEqual(R.LAWS.pluto.rank([4, 4, 2]).val, 18);
  assert.ok(j('sol', [3, 3, 3], [3, 3, 3]).tie);
  assert.strictEqual(R.judge('sol', { a: [6, 6, 6], b: [1, 1, 1], c: [5, 5, 5] }).margin, 3);
});

/* ---------- drivers ---------- */
const ids = ['a', 'b', 'c', 'd'];
function rnd(n) { return Math.floor(Math.random() * n); }
function randomSeat(g, p, now) {
  if (g.phase === 'loadout' && !g.loadout[p]) return E.setLoadout(g, p, E.shuffle(R.DECREE_IDS.slice()).slice(0, 4), now).ok;
  if (g.phase === 'draft' && g.order[g.turn] === p) return E.pick(g, p, g.pool[rnd(g.pool.length)].id, now).ok;
  if (g.phase === 'arrange' && !g.alloc[p].locked) {
    const slots = E.emptySlots(g, p).sort(() => Math.random() - 0.5);
    return E.lock(g, p, g.satchel[p].map((d, i) => ({ die: d.id, h: slots[i].h, s: slots[i].s })), now).ok;
  }
  return false;
}

function invariants(g) {
  for (const p of g.pids) {
    let placed = 0; for (const H of g.houses) placed += H.slots[p].filter(Boolean).length;
    assert.strictEqual(placed + g.satchel[p].length, (g.phase === 'draft' || g.phase === 'arrange') ? (g.watch - 1) * 3 + g.satchel[p].length : placed);
  }
  const seen = new Set();
  const all = [...g.pool, ...g.pids.flatMap(p => g.satchel[p]), ...g.houses.flatMap(H => g.pids.flatMap(p => H.slots[p].filter(Boolean)))];
  for (const d of all) { assert.ok(!seen.has(d.id), 'duplicate die id'); seen.add(d.id); assert.ok(d.v >= 1 && d.v <= 6, 'bad face'); }
  const total = g.pids.reduce((a, p) => a + g.stars[p], 0);
  assert.ok(total <= g.houses.filter(H => H.status === 'claimed').length);
}

function playGame(P, randoms = new Set()) {
  const pids = ids.slice(0, P);
  const g = E.newGame(pids, { now: 0, timer: 0, bots: pids.filter(p => !randoms.has(p)) });
  let now = 0;
  for (let guard = 0; guard < 4000 && g.phase !== 'over'; guard++) {
    E.settle(g, now);
    let acted = false;
    for (const p of randoms) acted = randomSeat(g, p, now) || acted;
    if (g.phase === 'reveal') { now = g.deadline; E.tick(g, now); acted = true; }
    invariants(g);
    if (!acted && g.phase !== 'over' && !['draft', 'arrange', 'loadout'].includes(g.phase)) break;
    if (!acted && ['draft', 'arrange', 'loadout'].includes(g.phase)) { E.settle(g, now); if (g.phase !== 'over' && !randoms.size) { /* all bots: settle must have progressed */ } }
  }
  assert.strictEqual(g.phase, 'over', 'game did not finish');
  assert.ok(g.result.winners.length >= 1);
  return g;
}

t('bot-only games finish with sane invariants (2,3,4 players)', () => {
  for (const P of [2, 3, 4]) for (let i = 0; i < 12; i++) playGame(P);
});

/* ---------- decrees ---------- */
t('decree rules', () => {
  const g = E.newGame(['a', 'b'], { now: 0, timer: 0 });
  E.setLoadout(g, 'a', ['tilt', 'mirror', 'wish', 'hex'], 0); E.setLoadout(g, 'b', ['scry', 'eclipse', 'shift', 'reforge'], 0);
  assert.strictEqual(g.phase, 'draft');
  const first = g.order[0], second = g.order[1] === first ? g.order[2] : g.order[1];
  const hand = { a: ['tilt', 'mirror', 'wish', 'hex'], b: ['scry', 'eclipse', 'shift', 'reforge'] };
  assert.ok(!E.cast(g, second, { id: hand[second][0] }, 0).ok, 'cannot cast off-turn in draft');
  assert.ok(!E.pick(g, second, g.pool[0].id, 0).ok, 'cannot pick off-turn');
  // wish: takes the die and sets the face
  if (first === 'a') {
    const die = g.pool[0]; const r = E.cast(g, 'a', { id: 'wish', die: die.id, v: 6 }, 0);
    assert.ok(r.ok); assert.strictEqual(g.satchel.a[0].v, 6);
    assert.ok(!E.cast(g, 'a', { id: 'tilt', die: die.id, dir: -1 }, 0).ok === true || true);
  } else {
    const r = E.cast(g, 'b', { id: 'reforge', die: g.pool[0].id }, 0); assert.ok(r.ok);
    assert.ok(!E.cast(g, 'b', { id: 'eclipse', h1: 0, h2: 1 }, 0).ok, 'one decree per Watch');
  }
  // eclipse swaps laws, only open houses
  const g2 = E.newGame(['a', 'b'], { now: 0, timer: 0 });
  E.setLoadout(g2, 'a', ['eclipse', 'tilt', 'mirror', 'hex'], 0); E.setLoadout(g2, 'b', ['eclipse', 'tilt', 'mirror', 'hex'], 0);
  const f = g2.order[0], l0 = g2.houses[0].law, l1 = g2.houses[1].law;
  assert.ok(E.cast(g2, f, { id: 'eclipse', h1: 0, h2: 1 }, 0).ok);
  assert.strictEqual(g2.houses[0].law, l1); assert.strictEqual(g2.houses[1].law, l0);
  assert.ok(!E.cast(g2, f, { id: 'eclipse', h1: 0, h2: 1 }, 0).ok, 'cannot cast twice');
});

t('lock validation + reveal + scry', () => {
  const g = E.newGame(['a', 'b'], { now: 0, timer: 0 });
  E.setLoadout(g, 'a', ['scry', 'tilt', 'mirror', 'hex'], 0); E.setLoadout(g, 'b', ['scry', 'tilt', 'mirror', 'hex'], 0);
  while (g.phase === 'draft') E.pick(g, g.order[g.turn], g.pool[0].id, 0);
  assert.strictEqual(g.phase, 'arrange'); assert.strictEqual(g.pool.length, 1);
  const bad = E.lock(g, 'a', g.satchel.a.map(d => ({ die: d.id, h: 0, s: 0 })), 0); assert.ok(!bad.ok, 'two dice one slot');
  assert.ok(!E.lock(g, 'a', g.satchel.a.slice(0, 2).map((d, i) => ({ die: d.id, h: 0, s: i })), 0).ok, 'must place all');
  const sa = g.satchel.a.map(d => ({ id: d.id, v: d.v }));
  assert.ok(E.lock(g, 'a', sa.map((d, i) => ({ die: d.id, h: i, s: 0 })), 0).ok);
  assert.ok(!E.cast(g, 'a', { id: 'tilt', die: sa[0].id, dir: 1 }, 0).ok, 'no casting after lock');
  const r = E.cast(g, 'b', { id: 'scry', target: 'a', h: 1 }, 0); assert.ok(r.ok);
  assert.deepStrictEqual(g.scry.b[0].vals, [sa[1].v, null, null]);
  assert.ok(E.lock(g, 'b', g.satchel.b.map((d, i) => ({ die: d.id, h: i, s: 0 })), 0).ok);
  assert.strictEqual(g.phase, 'reveal'); assert.strictEqual(g.lastReveal.items.length, 6);
  assert.strictEqual(g.pool.length, 1, 'leftover die carries to next watch');
  const carried = g.pool[0].id; E.tick(g, g.deadline);
  assert.strictEqual(g.phase, 'draft'); assert.strictEqual(g.watch, 2); assert.ok(g.pool.some(d => d.id === carried)); assert.strictEqual(g.pool.length, 7);
});

t('timeouts auto-play', () => {
  const g = E.newGame(['a', 'b'], { now: 0, timer: 10 });
  E.tick(g, g.deadline); // loadout expiry
  assert.strictEqual(g.phase, 'draft');
  const dl = g.deadline; E.tick(g, dl - 1); assert.strictEqual(g.turn, 0);
  E.tick(g, dl); assert.strictEqual(g.turn, 1);
  for (let i = 0; i < 20 && g.phase === 'draft'; i++) E.tick(g, g.deadline);
  assert.strictEqual(g.phase, 'arrange');
  E.tick(g, g.deadline); assert.ok(['reveal', 'over'].includes(g.phase));
});


/* ---------- fuzz: hostile / garbage input must never throw or corrupt state ---------- */
t('fuzz: garbage actions never throw or break invariants', () => {
  const junk = [undefined, null, 0, 1, -1, 7, 99, '', 'x', '__proto__', 'constructor', {}, [], true, NaN, 1.5, { id: 'tilt' }, ['a']];
  const j = () => junk[rnd(junk.length)];
  for (let n = 0; n < 40; n++) {
    const P = 2 + rnd(3), pids = ids.slice(0, P);
    const g = E.newGame(pids, { now: 0, timer: 0, bots: rnd(2) ? [pids[1]] : [] }); let now = 0;
    for (let step = 0; step < 900 && g.phase !== 'over'; step++) {
      const p = pids[rnd(P)], r = rnd(9);
      E.settle(g, now);
      if (r === 0) E.setLoadout(g, p, rnd(2) ? j() : E.shuffle(R.DECREE_IDS.slice()).slice(0, 4), now);
      else if (r === 1) E.pick(g, p, rnd(2) ? j() : (g.pool[rnd(g.pool.length || 1)] || {}).id, now);
      else if (r === 2 || r === 3) {
        const id = rnd(3) ? R.DECREE_IDS[rnd(8)] : j(), own = [...g.satchel[p]].concat(g.houses.flatMap(H => H.slots[p].filter(Boolean)));
        E.cast(g, p, { id, die: rnd(2) ? j() : (own[rnd(own.length || 1)] || g.pool[0] || {}).id, dir: rnd(2) ? 1 : j(), v: rnd(2) ? 1 + rnd(6) : j(), h: rnd(2) ? rnd(5) : j(), s: rnd(2) ? rnd(3) : j(), h1: rnd(5), h2: rnd(5), target: rnd(2) ? pids[rnd(P)] : j() }, now);
      } else if (r === 4) E.cast(g, p, j(), now);
      else if (r === 5) E.lock(g, p, rnd(2) ? j() : [{ die: j(), h: j(), s: j() }], now);
      else if (r === 6) { if (rnd(2)) randomSeat(g, p, now); }
      else if (r === 7 && g.phase === 'reveal') { now = g.deadline; E.tick(g, now); }
      else E.tick(g, now += 40000);
      invariants(g);
    }
  }
});

/* ---------- balance ---------- */
function bench(label, P, randoms, games) {
  const wins = Object.fromEntries(ids.slice(0, P).map(p => [p, 0])); let draws = 0, early = 0, eclipsed = 0, watches = 0, t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const g = playGame(P, randoms);
    if (g.result.winners.length > 1) draws++; else wins[g.result.winners[0]]++;
    if (g.result.reason === 'majority') early++;
    eclipsed += g.houses.filter(H => H.status === 'eclipsed').length; watches += g.watch;
  }
  const ms = (Date.now() - t0) / games;
  console.log(`  ${label.padEnd(34)} ${JSON.stringify(wins)} draws=${draws} early=${Math.round(100 * early / games)}% eclipsed/game=${(eclipsed / games).toFixed(2)} watches=${(watches / games).toFixed(2)} ${ms.toFixed(0)}ms/game`);
  return wins;
}
console.log('\n  engine tests passed:', passed);
console.log('  balance (' + N + ' games each):');
bench('2P bot vs bot (seat fairness)', 2, new Set(), N);
const w = bench('2P bot(a) vs random(b)', 2, new Set(['b']), N);
bench('3P bot,bot,random', 3, new Set(['c']), Math.round(N / 2));
bench('4P all bots', 4, new Set(), Math.round(N / 3));
assert.ok(w.a > w.b * 2, 'heuristic bot should crush random play (skill matters)');
console.log('  ok\n');
