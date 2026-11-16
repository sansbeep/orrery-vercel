'use strict';
/* The transport layer. One `app` per process / function instance:
 *   app.http(req, res)      the HTTP API: /api/health, /api/rpc (actions), /api/poll (state sync).
 *                           This is the fallback that works everywhere — including Vercel and networks that block WebSockets.
 *   app.attachSocket(io)    wires a Socket.IO server to the same rooms (live pushes, ~instant).
 * Both talk to the same store, so a Socket.IO player and an HTTP-polling player can sit in the same room. */
const { createStore } = require('./store.js');
const { makeTokens } = require('./tokens.js');
const { rpc, cleanCode } = require('./rpc.js');
const S = require('./service.js');

const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};

async function readJson(req, limit = 16384) {
  let b = req.body;                                   // Vercel pre-parses JSON bodies
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  if (Buffer.isBuffer(b)) { try { return JSON.parse(b.toString('utf8')); } catch (e) { return {}; } }
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { resolve({}); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const connectedPids = (presence, now) => Object.keys(presence).filter(p => now - presence[p] < S.PRESENCE_MS);

function createApp(opts = {}) {
  const store = opts.store || createStore();
  const tokens = makeTokens(store.secret);
  const deps = { store, tokens };
  const info = { mode: opts.mode || 'node', socketPath: opts.socketPath || '/socket.io', wsOnly: !!opts.wsOnly, socket: opts.socket !== false };

  /* ---------- HTTP polling API ---------- */
  async function poll(q) {
    const code = cleanCode(q.get('code')), v = +q.get('v') || 0, now = Date.now();
    const pid = tokens.verify(code, q.get('token'));
    if (!pid) return { ok: false, auth: true, error: 'That session has ended.' };
    let meta = await store.meta(code);
    if (!meta) return { ok: false, gone: true, error: 'That room has expired.' };
    if (q.get('hb') === '1') await store.touch(code, pid, now);
    if (meta.dl && meta.dl <= now) {                                   // a timer ran out: whoever polls first applies it
      const r = await store.mutate(code, room => ({ changed: S.tick(room, now) }));
      if (r && r.changed) meta = { v: r.room.v, dl: 0 };
    }
    if (meta.v === v) {
      const out = { ok: true, same: true, v };
      if (q.get('p') === '1') out.conn = connectedPids(await store.presence(code), now);
      return out;
    }
    const room = await store.get(code);
    if (!room) return { ok: false, gone: true, error: 'That room has expired.' };
    if (!S.playerOf(room, pid)) return { ok: false, auth: true, error: 'You are no longer in this room.' };
    return { ok: true, same: false, v: room.v, view: S.view(room, pid, await store.presence(code), now) };
  }

  async function http(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url, 'http://x'), path = url.pathname.replace(/\/+$/, '');
      if (path === '/api/health') return json(res, 200, Object.assign({ ok: true, store: store.kind, persistent: store.persistent, t: Date.now() }, info, store.stats ? store.stats() : {}));
      if (path === '/api/rpc' && req.method === 'POST') {
        const out = await rpc(deps, await readJson(req));
        return json(res, 200, out);                                    // `_room` is non-enumerable, so it never leaks
      }
      if (path === '/api/poll') return json(res, 200, await poll(url.searchParams));
      return json(res, 404, { ok: false, error: 'Not found.' });
    } catch (e) {
      if (e && e.busy) return json(res, 503, { ok: false, busy: true, error: 'The room is busy, retrying…' });
      console.error('[orrery] api error:', e && e.stack || e);
      return json(res, 500, { ok: false, error: 'Server error. Please try again.' });
    }
  }

  /* ---------- Socket.IO ---------- */
  function attachSocket(io) {
    const watch = new Map();      // room code -> { socks:Set, lastV, lastConn }

    const bind = (socket, code, pid, token) => {
      unbind(socket);
      Object.assign(socket.data, { code, pid, token });
      let w = watch.get(code); if (!w) watch.set(code, w = { socks: new Set(), lastV: -1, lastConn: '', busy: false });
      w.socks.add(socket);
    };
    const unbind = socket => {
      const { code } = socket.data || {}; if (!code) return;
      const w = watch.get(code); if (w) { w.socks.delete(socket); if (!w.socks.size) watch.delete(code); }
      socket.data.code = socket.data.pid = socket.data.token = null;
    };

    async function push(code, room) {
      const w = watch.get(code); if (!w) return;
      const now = Date.now(), presence = await store.presence(code);
      w.lastV = room.v; w.lastConn = connectedPids(presence, now).sort().join(',');
      for (const s of w.socks) if (s.data.pid) s.emit('state', S.view(room, s.data.pid, presence, now));
    }

    io.on('connection', socket => {
      socket.data = { code: null, pid: null, token: null, bucket: 12, bt: Date.now() };
      socket.emit('hello', { t: Date.now(), store: store.kind, mode: info.mode });

      socket.on('rpc', async (msg, ack) => {
        if (typeof ack !== 'function') ack = () => {};
        const d = socket.data, now = Date.now();
        d.bucket = Math.min(12, d.bucket + (now - d.bt) / 250); d.bt = now;       // ~4 actions/s sustained, bursts of 12
        if (d.bucket < 1) return ack({ ok: false, error: 'Slow down a little.' });
        d.bucket -= 1;
        try {
          const m = msg && typeof msg === 'object' ? msg : {}, ev = String(m.ev || '').slice(0, 12);
          const entry = ev === 'create' || ev === 'join' || ev === 'rejoin';
          const res = await rpc(deps, { ev, data: m.data, code: entry ? m.code : d.code, token: ev === 'rejoin' ? m.token : d.token });
          if (res.ok && entry) bind(socket, res.code, res.pid, ev === 'rejoin' ? m.token : res.token);
          const room = res._room; delete res.view;
          if (res.ok && ev === 'leave') { const code = d.code, pid = d.pid; unbind(socket); store.touch(code, pid, 0).catch(() => {}); }
          ack(res);
          if (room && res.ok) await push(room.code, room);
        } catch (e) {
          if (!(e && e.busy)) console.error('[orrery] socket error:', e && e.stack || e);
          ack({ ok: false, error: e && e.busy ? 'The room is busy, try again.' : 'Server error.' });
        }
      });

      socket.on('disconnect', async () => {
        const { code, pid } = socket.data; unbind(socket);
        if (!code) return;
        try { await store.touch(code, pid, 0); const room = await store.get(code); if (room) await push(code, room); } catch (e) { /* ignore */ }
      });
    });

    /* One loop keeps every watched room in sync with the store: fires timers, and picks up changes made by other
     * instances or by HTTP-polling players. (With the in-memory store this is nearly free.) */
    let n = 0;
    const loop = setInterval(async () => {
      n++;
      for (const [code, w] of watch) {
        if (w.busy) continue; w.busy = true;
        try {
          const meta = await store.meta(code), now = Date.now();
          if (!meta) { for (const s of w.socks) s.emit('gone', { code }); watch.delete(code); continue; }
          if (meta.dl && meta.dl <= now) {
            const r = await store.mutate(code, room => ({ changed: S.tick(room, now) }));
            if (r && r.changed) { await push(code, r.room); continue; }
          }
          if (meta.v !== w.lastV) { const room = await store.get(code); if (room) await push(code, room); continue; }
          if (n % 4 === 0) {
            const conn = connectedPids(await store.presence(code), now).sort().join(',');
            if (conn !== w.lastConn) { const room = await store.get(code); if (room) await push(code, room); }
          }
        } catch (e) { /* transient store error: try again next tick */ } finally { w.busy = false; }
      }
    }, 700);
    if (loop.unref) loop.unref();
    return { watch };
  }

  return { store, tokens, deps, info, http, attachSocket, poll };
}

module.exports = { createApp };
