'use strict';
/* Simulates how Vercel runs the /api functions: every function file is loaded as its OWN isolated instance (nothing shared
 * but Redis), JSON bodies arrive pre-parsed on req.body like Vercel's runtime does, and the Socket.IO function is reached
 * at /api/socket-io/socket.io over the WebSocket transport only (with the prefix kept, and with it stripped).
 *   node test/vercel-sim.js */
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };

function freshRequire(file) {                       // load a function file with a brand-new module graph (= a new instance)
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT + path.sep) && !k.includes('node_modules')) delete require.cache[k];
  return require(path.join(ROOT, file));
}

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

async function main() {
  const rport = 6500 + Math.floor(Math.random() * 100);
  const redis = spawn('redis-server', ['--port', String(rport), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  await sleep(500); execSync('redis-cli -p ' + rport + ' ping', { stdio: 'pipe' });
  process.env.REDIS_URL = 'redis://127.0.0.1:' + rport; process.env.ORRERY_REVEAL_MS = '300'; process.env.ORRERY_BOT_SAMPLES = '24';
  console.log('\n  ORRERY vercel simulation');

  // three separate lambdas
  const fns = { health: freshRequire('api/health.js'), rpc: freshRequire('api/rpc.js'), poll: freshRequire('api/poll.js') };
  const router = http.createServer(async (req, res) => {
    const p = req.url.split('?')[0].replace(/\/$/, '');
    const key = p === '/api/health' ? 'health' : p === '/api/rpc' ? 'rpc' : p === '/api/poll' ? 'poll' : null;
    if (!key) { res.writeHead(404); return res.end('not found'); }          // like Vercel: no /socket.io on the static site
    if (req.method === 'POST') {                                              // Vercel's runtime parses JSON into req.body
      let b = ''; for await (const c of req) b += c; req.body = JSON.parse(b || '{}');
    }
    fns[key](req, res);
  });
  const base = 'http://127.0.0.1:' + await listen(router);

  const health = await (await fetch(base + '/api/health')).json();
  ok(health.mode === 'vercel' && health.wsOnly === true && health.socketPath === '/api/socket-io/socket.io' && health.persistent, 'health advertises the vercel socket path + persistence');
  ok((await fetch(base + '/socket.io/?EIO=4&transport=polling')).status === 404, 'plain /socket.io is not available on vercel (so the client must fall back or use the api path)');

  // the websocket function: prefix kept (full URL) and prefix stripped
  const wsServer = freshRequire('api/socket-io.js');
  const wsPort = await listen(wsServer);
  const wsBase = 'http://127.0.0.1:' + wsPort;

  const sock = (transports) => io(wsBase, { path: '/api/socket-io/socket.io', transports, forceNew: true, reconnection: false });
  const a = sock(['websocket']); await new Promise((res, rej) => { a.on('connect', res); a.on('connect_error', rej); });
  ok(a.io.engine.transport.name === 'websocket', 'connected over websocket at /api/socket-io/socket.io');
  const poll = io(wsBase, { path: '/api/socket-io/socket.io', transports: ['polling'], forceNew: true, reconnection: false, timeout: 1500 });
  const pollFailed = await new Promise(r => { poll.on('connect', () => r(false)); poll.on('connect_error', () => r(true)); setTimeout(() => r(true), 2500); });
  ok(pollFailed, 'socket.io long-polling is refused on the vercel function (websocket-only) — which is why the HTTP API fallback exists'); poll.close();

  // stripped-prefix variant: connect to the server using the bare /socket.io path (as if Vercel removed the function prefix)
  const b0 = io(wsBase, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((res, rej) => { b0.on('connect', res); b0.on('connect_error', rej); }); ok(true, 'bare /socket.io path also accepted'); b0.close();

  // game: Alice over the websocket function, Bob via the HTTP api functions (different "instances")
  let viewA = null; a.on('state', v => { viewA = v; });
  const act = (s, ev, data, extra) => new Promise(r => s.emit('rpc', Object.assign({ ev, data }, extra), r));
  const post = body => fetch(base + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const cr = await act(a, 'create', { name: 'Alice', timer: 0 }); ok(cr.ok, 'create via ws function');
  const jb = await post({ ev: 'join', code: cr.code, data: { name: 'Bob' } }); ok(jb.ok, 'join via http function');
  let viewB = jb.view, vB = jb.v;
  let stop = false;
  (async () => { while (!stop) { try { const j = await (await fetch(base + '/api/poll?' + new URLSearchParams({ code: cr.code, token: jb.token, v: vB, hb: '1' }))).json(); if (j.ok && !j.same) { viewB = j.view; vB = j.v; } } catch (e) { /* retry */ } await sleep(80); } })();
  const t0 = Date.now(); while (!(viewA && viewA.players.length === 2) && Date.now() - t0 < 5000) await sleep(40);
  ok(viewA && viewA.players.length === 2, 'ws player sees the http player join (cross-instance)');
  ok((await act(a, 'start', {})).ok, 'start');

  const turn = async (me, send, view) => {
    const g = view && view.game; if (!g) return;
    if (g.phase === 'loadout' && !g.decrees.mine.hand.length) await send('loadout', { ids: ['tilt', 'mirror', 'wish', 'scry'] });
    else if (g.phase === 'draft' && g.turnPid === me) await send('pick', { die: g.pool[0].id });
    else if (g.phase === 'arrange' && !g.locked[me]) {
      const slots = []; g.houses.forEach((H, h) => { if (H.status === 'open') H.slots[me].forEach((d, s) => { if (!d) slots.push({ h, s }); }); });
      await send('lock', { assign: g.satchel[me].map((d, i) => ({ die: d.id, h: slots[i].h, s: slots[i].s })) });
    }
  };
  const t1 = Date.now();
  while (Date.now() - t1 < 60000 && !(viewA && viewA.game && viewA.game.phase === 'over' && viewB && viewB.game && viewB.game.phase === 'over')) {
    await turn(viewA && viewA.you, (ev, d) => act(a, ev, d), viewA);
    await turn(viewB && viewB.you, async (ev, d) => { const r = await post({ ev, data: d, code: cr.code, token: jb.token }); if (r.view) { viewB = r.view; vB = r.v; } }, viewB);
    await sleep(40);
  }
  ok(viewA.game.phase === 'over' && viewB.game.phase === 'over', 'full game across ws function + http functions');
  ok(JSON.stringify(viewA.game.result.winners) === JSON.stringify(viewB.game.result.winners), 'both transports agree on the winner');
  stop = true; a.close();
  console.log('  ok  isolated lambdas + Redis: websocket function, HTTP functions, bare + prefixed socket paths, polling refused');
  console.log('\n  ' + checks + ' checks passed\n');
  redis.kill(); wsServer.close(); router.close(); process.exit(0);
}
main().catch(e => { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });
