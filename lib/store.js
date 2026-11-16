'use strict';
/* Room storage. Two interchangeable backends behind one async API:
 *
 *   memory  — a Map in this process. Perfect for a single Node host (Render, Railway, Fly, your laptop).
 *   redis   — shared storage, REQUIRED on Vercel (functions are stateless and many instances run at once).
 *             Speaks either the Upstash REST API (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN — plain
 *             fetch, no sockets) or a normal Redis connection (REDIS_URL, via the `redis` package).
 *
 * API:  create(room) -> bool        get(code) -> room|null        meta(code) -> {v, dl}|null
 *       mutate(code, fn) -> {room, out, changed}|null   (fn(room) => {changed, out}; serialised per room)
 *       touch(code, pid, ts) / presence(code) -> {pid: ts}
 */
const crypto = require('crypto');

const TTL_S = 6 * 3600;
const nowMs = () => Date.now();
const deadlineOf = room => (room.game && room.game.deadline) || 0;

/* ---------------- memory ---------------- */
function memoryStore() {
  const rooms = new Map(), pres = new Map(), chains = new Map();
  const serial = (code, job) => {           // run jobs for one room strictly one after another
    const prev = chains.get(code) || Promise.resolve();
    const next = prev.then(job, job);
    chains.set(code, next.catch(() => {}));
    return next;
  };
  const sweep = setInterval(() => {
    const cut = nowMs() - TTL_S * 1000;
    for (const [c, r] of rooms) if (r.updated < cut) { rooms.delete(c); pres.delete(c); chains.delete(c); }
  }, 10 * 60 * 1000);
  if (sweep.unref) sweep.unref();
  return {
    kind: 'memory', persistent: false,
    async create(room) { if (rooms.has(room.code)) return false; rooms.set(room.code, room); pres.set(room.code, {}); return true; },
    async get(code) { return rooms.get(code) || null; },
    async meta(code) { const r = rooms.get(code); return r ? { v: r.v, dl: deadlineOf(r) } : null; },
    mutate(code, fn) {
      return serial(code, async () => {
        const room = rooms.get(code); if (!room) return null;
        const r = fn(room) || {};
        if (r.changed) { room.v += 1; room.updated = nowMs(); }
        return { room, out: r.out, changed: !!r.changed };
      });
    },
    async touch(code, pid, ts) { const p = pres.get(code); if (p) p[pid] = ts === undefined ? nowMs() : ts; },
    async presence(code) { return Object.assign({}, pres.get(code) || {}); },
    stats() { return { rooms: rooms.size }; }
  };
}

/* ---------------- redis drivers ---------------- */
function restDriver(url, token) {
  url = url.replace(/\/+$/, '');
  const call = async (path, body) => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.status >= 500) throw new Error('redis http ' + res.status);
        const j = await res.json();
        return j;
      } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 80)); }
    }
    throw lastErr;
  };
  return {
    kind: 'redis-rest',
    async exec(args) { const j = await call('', args); if (j && j.error) throw new Error(j.error); return j.result; },
    async pipeline(cmds) { const j = await call('/pipeline', cmds); return j.map(x => { if (x && x.error) throw new Error(x.error); return x.result; }); }
  };
}

function tcpDriver(urlStr) {
  let client = null, connecting = null;
  const get = async () => {
    if (client && client.isReady) return client;
    if (!connecting) {
      const { createClient } = require('redis');
      const c = createClient({ url: urlStr, socket: { reconnectStrategy: n => Math.min(n * 100, 1500) } });
      c.on('error', () => {});
      connecting = c.connect().then(() => { client = c; connecting = null; return c; }, e => { connecting = null; throw e; });
    }
    return connecting;
  };
  return {
    kind: 'redis-tcp',
    async exec(args) { const c = await get(); return c.sendCommand(args.map(String)); },
    async pipeline(cmds) { const c = await get(); return Promise.all(cmds.map(a => c.sendCommand(a.map(String)))); }
  };
}

const pairs = flat => {                       // HGETALL -> {k: v}, whichever shape the driver returns
  if (!flat) return {};
  if (!Array.isArray(flat)) return Object.assign({}, flat);
  const o = {}; for (let i = 0; i + 1 < flat.length; i += 2) o[flat[i]] = flat[i + 1]; return o;
};

function redisStore(driver) {
  const K = { room: c => 'orrery:r:' + c, meta: c => 'orrery:m:' + c, pres: c => 'orrery:p:' + c, lock: c => 'orrery:l:' + c };
  const chains = new Map();
  const serial = (code, job) => { const prev = chains.get(code) || Promise.resolve(); const next = prev.then(job, job); chains.set(code, next.catch(() => {})); return next; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  return {
    kind: driver.kind, persistent: true,
    async create(room) {
      const ok = await driver.exec(['SET', K.room(room.code), JSON.stringify(room), 'NX', 'EX', TTL_S]);
      if (ok !== 'OK') return false;
      await driver.pipeline([['HSET', K.meta(room.code), 'v', room.v, 'dl', 0], ['EXPIRE', K.meta(room.code), TTL_S]]);
      return true;
    },
    async get(code) { const raw = await driver.exec(['GET', K.room(code)]); return raw ? JSON.parse(raw) : null; },
    async meta(code) {
      const [v, dl] = await driver.exec(['HMGET', K.meta(code), 'v', 'dl']);
      return v === null || v === undefined ? null : { v: +v, dl: +dl || 0 };
    },
    mutate(code, fn) {
      return serial(code, async () => {
        const lk = K.lock(code), mine = crypto.randomBytes(6).toString('hex');
        let got = false;
        for (let i = 0; i < 30 && !got; i++) {                      // a short-lived lock so two instances never write at once
          got = (await driver.exec(['SET', lk, mine, 'NX', 'PX', 5000])) === 'OK';
          if (!got) await sleep(40 + Math.random() * 70);
        }
        if (!got) { const e = new Error('room busy'); e.busy = true; throw e; }
        try {
          const raw = await driver.exec(['GET', K.room(code)]);
          if (!raw) return null;
          const room = JSON.parse(raw);
          const r = fn(room) || {};
          if (r.changed) {
            room.v += 1; room.updated = nowMs();
            await driver.pipeline([
              ['SET', K.room(code), JSON.stringify(room), 'EX', TTL_S],
              ['HSET', K.meta(code), 'v', room.v, 'dl', deadlineOf(room)],
              ['EXPIRE', K.meta(code), TTL_S]]);
          }
          return { room, out: r.out, changed: !!r.changed };
        } finally { try { await driver.exec(['DEL', lk]); } catch (e) { /* lock expires on its own */ } }
      });
    },
    async touch(code, pid, ts) { await driver.pipeline([['HSET', K.pres(code), pid, ts === undefined ? nowMs() : ts], ['EXPIRE', K.pres(code), TTL_S]]); },
    async presence(code) { const o = pairs(await driver.exec(['HGETALL', K.pres(code)])); for (const k in o) o[k] = +o[k]; return o; },
    stats() { return {}; }
  };
}

/* Pick a backend from the environment. */
function createStore(env = process.env) {
  const restUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const restTok = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  let store, secretSeed = null;
  if (restUrl && restTok) { store = redisStore(restDriver(restUrl, restTok)); secretSeed = restUrl + '|' + restTok; }
  else if (env.REDIS_URL) { store = redisStore(tcpDriver(env.REDIS_URL)); secretSeed = env.REDIS_URL; }
  else store = memoryStore();
  // every instance must derive the SAME token secret when they share a database
  store.secret = env.ORRERY_SECRET || (secretSeed ? crypto.createHash('sha256').update('orrery|' + secretSeed).digest('hex') : crypto.randomBytes(24).toString('hex'));
  return store;
}

module.exports = { createStore, memoryStore, redisStore, restDriver, tcpDriver, TTL_S };
