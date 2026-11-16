'use strict';
/* One entry point for every client action, whatever the transport (Socket.IO message or HTTP POST).
 *   rpc(deps, { ev, data, code, token }) -> { ok, error?, code?, pid?, token?, view?, v? }
 * deps = { store, tokens } */
const S = require('./service.js');

const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const SESSION_GONE = { ok: false, auth: true, error: 'That session has ended. Rejoin with the room code.' };

async function withView(deps, res, code, room, pid, now) {
  const presence = await deps.store.presence(code);
  res.v = room.v; res.view = S.view(room, pid, presence, now);
  Object.defineProperty(res, '_room', { value: room, enumerable: false });   // for the transport layer (never serialised)
  return res;
}

async function rpc(deps, req, now = Date.now()) {
  const { store, tokens } = deps;
  const ev = String(req.ev || '').slice(0, 12), data = req.data && typeof req.data === 'object' ? req.data : {};

  if (ev === 'create') {
    for (let i = 0; i < 8; i++) {
      const code = S.newCode(), made = S.makeRoom(code, data.name, tokens, now, data.timer);
      if (await store.create(made.room)) {
        await store.touch(code, made.pid, now);
        return withView(deps, { ok: true, code, pid: made.pid, token: made.token }, code, made.room, made.pid, now);
      }
    }
    return { ok: false, error: 'Could not create a room. Please try again.' };
  }

  const code = cleanCode(req.code);
  if (code.length !== 4) return { ok: false, error: 'Enter the 4-letter room code.' };

  if (ev === 'join') {
    const r = await store.mutate(code, room => { const j = S.join(room, data.name, tokens, now); return { changed: j.ok, out: j }; });
    if (!r) return { ok: false, gone: true, error: 'No room with that code. Check the letters and try again.' };
    if (!r.out.ok) return r.out;
    await store.touch(code, r.out.pid, now);
    return withView(deps, { ok: true, code, pid: r.out.pid, token: r.out.token }, code, r.room, r.out.pid, now);
  }

  const pid = tokens.verify(code, req.token);
  if (!pid) return SESSION_GONE;

  if (ev === 'hb') { await store.touch(code, pid, now); return { ok: true }; }

  const r = await store.mutate(code, room => {
    if (!S.playerOf(room, pid)) return { changed: false, out: { ok: false, auth: true, error: SESSION_GONE.error } };
    const ticked = S.tick(room, now);
    if (ev === 'rejoin' || ev === 'sync') return { changed: ticked, out: { ok: true } };
    const out = S.apply(room, pid, ev, data, now);
    return { changed: ticked || out.ok, out };
  });
  if (!r) return { ok: false, gone: true, error: 'That room has expired.' };
  await store.touch(code, pid, now);
  const res = Object.assign({}, r.out, { code, pid });
  return withView(deps, res, code, r.room, pid, now);
}

module.exports = { rpc, cleanCode };
