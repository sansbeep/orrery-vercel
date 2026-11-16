'use strict';
/* End-to-end tests against real server processes.
 *   node test/integration.js
 * Covers: Socket.IO websocket, Socket.IO polling-only, the HTTP fallback API, mixed rooms, forged tokens, privacy of hidden
 * dice, and — with a real redis-server — shared state across TWO server processes (Vercel's situation) over both the
 * Upstash-REST driver and the plain REDIS_URL driver. */
const { spawn, execSync } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');
const R = require('../public/rules.js');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PORT = 9100 + Math.floor(Math.random() * 400);
const procs = []; let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

function startServer(env = {}) {
  const port = PORT++;
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: port, ORRERY_REVEAL_MS: '350', ORRERY_BOT_SAMPLES: '24' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  return new Promise((res, rej) => {
    let out = ''; const t = setTimeout(() => rej(new Error('server did not start: ' + out)), 8000);
    const on = d => { out += d; if (out.includes('ORRERY server is up')) { clearTimeout(t); res({ port, base: 'http://127.0.0.1:' + port, p }); } };
    p.stdout.on('data', on); p.stderr.on('data', d => { out += d; if (/Error/.test(String(d))) console.error(String(d)); });
  });
}

/* --------- three kinds of client, one interface:  act(ev, data) -> ack, and .view (latest state) --------- */
class SocketClient {
  constructor(base, transports, label) {
    this.label = label; this.view = null; this.sock = io(base, { transports, forceNew: true, reconnection: false });
    this.sock.on('state', v => { this.view = v; });
    this.ready = new Promise((res, rej) => { this.sock.on('connect', res); this.sock.on('connect_error', rej); });
  }
  async transport() { await this.ready; return this.sock.io.engine.transport.name; }
  async act(ev, data, extra) { await this.ready; return new Promise(r => this.sock.emit('rpc', Object.assign({ ev, data }, extra), r)); }
  close() { this.sock.close(); }
}
class HttpClient {
  constructor(base, label) { this.base = base; this.label = label; this.view = null; this.v = 0; this.ready = Promise.resolve(); this.stop = false; }
  async post(body) { const r = await fetch(this.base + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  async act(ev, data, extra) {
    const res = await this.post(Object.assign({ ev, data, code: this.code, token: this.token }, extra));
    if (res.ok && ev !== 'leave' && /^(create|join|rejoin)$/.test(ev)) { this.code = res.code; this.token = res.token || this.token; this.startPolling(); }
    if (res.view) { this.view = res.view; this.v = res.v; }
    return res;
  }
  startPolling() {
    if (this.polling) return; this.polling = true;
    (async () => {
      while (!this.stop) {
        try { const q = new URLSearchParams({ code: this.code, token: this.token, v: this.v, hb: '1', p: '1' }); const j = await (await fetch(this.base + '/api/poll?' + q)).json(); if (j.ok && !j.same) { this.view = j.view; this.v = j.v; } } catch (e) { /* keep going */ }
        await sleep(90);
      }
    })();
  }
  close() { this.stop = true; }
}

/* a tiny autoplayer that only uses what a real client sees */
async function playTurn(c, me) {
  const v = c.view; if (!v || !v.game) return false; const g = v.game;
  if (g.phase === 'loadout' && !g.decrees.mine.hand.length) return (await c.act('loadout', { ids: ['tilt', 'mirror', 'wish', 'scry'] })).ok;
  if (g.phase === 'draft' && g.turnPid === me && g.pool.length) return (await c.act('pick', { die: g.pool[Math.floor(Math.random() * g.pool.length)].id })).ok;
  if (g.phase === 'arrange' && !g.locked[me]) {
    const slots = []; g.houses.forEach((H, h) => { if (H.status === 'open') H.slots[me].forEach((d, s) => { if (!d) slots.push({ h, s }); }); });
    return (await c.act('lock', { assign: g.satchel[me].map((d, i) => ({ die: d.id, h: slots[i].h, s: slots[i].s })) })).ok;
  }
  return false;
}
async function playToEnd(clients, label, maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (clients.every(c => c.view && c.view.game && c.view.game.phase === 'over')) return;
    for (const c of clients) await playTurn(c, c.view && c.view.you);
    await sleep(40);
  }
  throw new Error(label + ': game did not finish; phases: ' + clients.map(c => c.view && c.view.game && c.view.game.phase).join(','));
}
async function waitFor(fn, ms = 6000, what = 'condition') { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(30); } throw new Error('timeout waiting for ' + what); }

/* ---------- scenarios ---------- */
async function scenarioFullGame(base, kinds, label) {
  const mk = (k, i) => k === 'ws' ? new SocketClient(base, ['websocket'], label + i) : k === 'poll' ? new SocketClient(base, ['polling'], label + i) : new HttpClient(base, label + i);
  const cs = kinds.map(mk);
  const a = await cs[0].act('create', { name: 'Alice', timer: 0 }); ok(a.ok && /^[A-Z]{4}$/.test(a.code), label + ' create');
  cs[0].code = a.code; cs[0].token = a.token; if (cs[0] instanceof HttpClient) cs[0].startPolling();
  for (let i = 1; i < cs.length; i++) {
    const j = await cs[i].act('join', { name: 'Player' + i }, { code: a.code }); ok(j.ok, label + ' join ' + (j.error || ''));
    cs[i].code = a.code; cs[i].token = j.token; if (cs[i] instanceof HttpClient) cs[i].startPolling();
  }
  await waitFor(() => cs.every(c => c.view && c.view.players.length === cs.length), 4000, label + ' lobby sync');
  if (kinds.length < 2) ok((await cs[0].act('bot', {})).ok, 'add bot');
  const st = await cs[0].act('start', {}); ok(st.ok, label + ' start ' + (st.error || ''));
  await playToEnd(cs, label);
  for (const c of cs) { const r = c.view.game.result; ok(r && r.winners.length >= 1, label + ' result'); ok(c.view.game.watch >= 3, label + ' watches played'); }
  const win = cs[0].view.game.result.winners; ok(cs.every(c => JSON.stringify(c.view.game.result.winners) === JSON.stringify(win)), label + ' everyone agrees on the winner');
  return cs;
}

function assertNoLeaks(view, me, label) {
  const g = view.game; if (!g) return;
  const json = JSON.stringify(view);
  ok(!/"token"/.test(json), label + ' no tokens in view');
  ok(!('alloc' in g), label + ' no raw allocation in view');
  for (const p of Object.keys(g.decrees.others)) ok(!('hand' in g.decrees.others[p]), label + ' opponents\' hands are hidden');
  if (g.phase === 'draft' || g.phase === 'arrange') {
    // dice placed this Watch must not be on the table yet: each player's board dice count == 3*(watch-1) at most
    for (const p of Object.keys(g.locked)) { let n = 0; g.houses.forEach(H => { n += H.slots[p].filter(Boolean).length; }); ok(n <= 3 * (g.watch - 1), label + ' hidden dice stay hidden until reveal'); }
  }
}

async function main() {
  console.log('\n  ORRERY integration tests');
  /* ===== single process, in-memory store ===== */
  const s1 = await startServer();
  let health = await (await fetch(s1.base + '/api/health')).json();
  ok(health.ok && health.mode === 'node' && health.socketPath === '/socket.io', 'health endpoint');
  const html = await (await fetch(s1.base + '/')).text(); ok(/ORRERY/i.test(html), 'serves the page');
  ok((await fetch(s1.base + '/../server.js')).status !== 200, 'no path traversal');
  ok((await fetch(s1.base + '/%2e%2e/server.js')).status !== 200, 'no encoded path traversal');

  let cs = await scenarioFullGame(s1.base, ['ws', 'ws'], 'ws/ws');
  ok(await cs[0].transport() === 'websocket', 'really on websocket');
  assertNoLeaks(cs[0].view, cs[0].view.you, 'ws'); cs.forEach(c => c.close());
  console.log('  ok  Socket.IO over WebSocket: full 2-player game');

  cs = await scenarioFullGame(s1.base, ['poll', 'poll'], 'poll/poll');
  ok(await cs[0].transport() === 'polling', 'really on polling'); cs.forEach(c => c.close());
  console.log('  ok  Socket.IO polling-only (WebSocket blocked): full 2-player game');

  cs = await scenarioFullGame(s1.base, ['http', 'http'], 'http/http'); assertNoLeaks(cs[0].view, cs[0].view.you, 'http'); cs.forEach(c => c.close());
  console.log('  ok  HTTP polling API only: full 2-player game');

  cs = await scenarioFullGame(s1.base, ['ws', 'http', 'poll'], 'mixed'); cs.forEach(c => c.close());
  console.log('  ok  mixed room (websocket + HTTP + socket-polling): full 3-player game');

  cs = await scenarioFullGame(s1.base, ['http'], 'solo+bot'); cs.forEach(c => c.close());
  console.log('  ok  solo vs bot');

  // security
  const A = new SocketClient(s1.base, ['websocket'], 'sec'), B = new HttpClient(s1.base, 'sec2');
  const r1 = await A.act('create', { name: 'Eve' }); ok(r1.ok, 'create');
  const r2 = await B.act('create', { name: 'Mallory' });
  const forged = await B.post({ ev: 'start', code: r1.code, token: r2.token }); ok(!forged.ok && forged.auth, 'token from another room is rejected');
  const forged2 = await B.post({ ev: 'start', code: r1.code, token: 'p1.AAAAAAAAAAAAAAAAAAAAAAAA' }); ok(!forged2.ok && forged2.auth, 'forged signature rejected');
  const forged3 = await B.post({ ev: 'start', code: r1.code, token: 'p1' }); ok(!forged3.ok, 'unsigned token rejected');
  const nocode = await B.post({ ev: 'join', code: 'ZZZZ', data: { name: 'x' } }); ok(!nocode.ok && nocode.gone, 'unknown room');
  const j = await B.post({ ev: 'join', code: r1.code, data: { name: '<img src=x onerror=alert(1)>' } }); ok(j.ok, 'join');
  ok(!/[<>]/.test(j.view.players[1].name), 'names are sanitised: ' + j.view.players[1].name);
  const hostOnly = await B.post({ ev: 'start', code: r1.code, token: j.token }); ok(!hostOnly.ok && /host/i.test(hostOnly.error), 'only the host can start');
  const badpick = await B.post({ ev: 'pick', data: { die: 1 }, code: r1.code, token: j.token }); ok(!badpick.ok, 'cannot act before the game starts');
  A.close();
  console.log('  ok  auth: forged / foreign / unsigned tokens, host-only actions, name sanitising');

  /* reconnect: a dropped player resumes their seat with their token */
  const P = new SocketClient(s1.base, ['websocket'], 'rc'); const mk = await P.act('create', { name: 'Rejoiner', timer: 0 });
  await P.act('bot', {}); await P.act('start', {}); P.close(); await sleep(200);
  const P2 = new SocketClient(s1.base, ['websocket'], 'rc2'); const rj = await P2.act('rejoin', {}, { code: mk.code, token: mk.token });
  ok(rj.ok && rj.pid === mk.pid, 'rejoin with token'); await waitFor(() => P2.view && P2.view.game, 3000, 'state after rejoin'); P2.close();
  console.log('  ok  reconnect resumes the same seat');
  s1.p.kill();

  /* ===== two server processes sharing one Redis (== Vercel's multi-instance reality) ===== */
  let redis = null, rport = 6391 + Math.floor(Math.random() * 100);
  try { redis = spawn('redis-server', ['--port', String(rport), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' }); procs.push(redis); await sleep(500); execSync('redis-cli -p ' + rport + ' ping', { stdio: 'pipe' }); }
  catch (e) { console.log('  (skipping Redis tests: redis-server unavailable)'); return finish(); }

  for (const mode of ['tcp', 'rest']) {
    let fake = null, env = {};
    if (mode === 'tcp') env = { REDIS_URL: 'redis://127.0.0.1:' + rport };
    else { const fu = require('./fake-upstash.js'); const up = 7800 + Math.floor(Math.random() * 90); fake = await fu.start(up, 'redis://127.0.0.1:' + rport, 'tok'); env = { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + up, UPSTASH_REDIS_REST_TOKEN: 'tok' }; }
    const X = await startServer(env), Y = await startServer(env);
    const hx = await (await fetch(X.base + '/api/health')).json(); ok(hx.store === (mode === 'tcp' ? 'redis-tcp' : 'redis-rest') && hx.persistent, mode + ': redis store selected');
    // Alice is on server X (websocket); Bob is on server Y (websocket); Cara talks HTTP to Y. Different instances, one game.
    const a = new SocketClient(X.base, ['websocket'], 'X'), b = new SocketClient(Y.base, ['websocket'], 'Y'), c = new HttpClient(Y.base, 'Yh');
    const cr = await a.act('create', { name: 'Alice', timer: 0 }); ok(cr.ok, mode + ' create');
    const jb = await b.act('join', { name: 'Bob' }, { code: cr.code }); ok(jb.ok, mode + ' join on other instance');
    const jc = await c.act('join', { name: 'Cara' }, { code: cr.code }); c.code = cr.code; c.token = jc.token; c.startPolling();
    await waitFor(() => [a, b, c].every(x => x.view && x.view.players.length === 3), 6000, mode + ' lobby sync across instances');
    ok((await a.act('start', {})).ok, mode + ' start');
    await playToEnd([a, b, c], mode + ' cross-instance', 90000);
    const w = a.view.game.result.winners; ok([b, c].every(x => JSON.stringify(x.view.game.result.winners) === JSON.stringify(w)), mode + ' all instances agree');
    // 12 concurrent hammering writers on one room must never corrupt it or deadlock
    const hh = await a.act('create', { name: 'Hammer', timer: 0 });
    const hs = await Promise.all([1, 2, 3].map(i => (i % 2 ? new HttpClient(X.base) : new HttpClient(Y.base)).post({ ev: 'join', code: hh.code, data: { name: 'H' + i } })));
    ok(hs.filter(x => x.ok).length === 3, mode + ' concurrent joins');
    const pids = new Set(hs.filter(x => x.ok).map(x => x.pid)); ok(pids.size === 3, mode + ' concurrent joins get distinct seats (' + [...pids] + ')');
    a.close(); b.close(); c.close(); X.p.kill(); Y.p.kill(); if (fake) await fake.close();
    console.log('  ok  ' + mode.toUpperCase().padEnd(4) + ' Redis, two server processes: cross-instance game, locking, concurrent joins');
  }
  finish();
}

function finish() { console.log('\n  ' + checks + ' checks passed\n'); procs.forEach(p => { try { p.kill(); } catch (e) { /* done */ } }); process.exit(0); }
main().catch(e => { console.error('\nFAILED:', e && e.stack || e); procs.forEach(p => { try { p.kill(); } catch (x) { /* done */ } }); process.exit(1); });
