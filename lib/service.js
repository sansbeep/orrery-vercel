'use strict';
/* Room-level logic: lobby, seats, bots, and routing of in-game actions to the engine.
 * Everything here is synchronous and operates on a plain JSON room object, so the exact same code runs
 * behind Socket.IO, behind the HTTP polling API, in memory or against Redis. */
const R = require('../public/rules.js');
const E = require('./engine.js');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';          // no I / L / O — easy to read out loud
const MAX_PLAYERS = 4, MIN_PLAYERS = 2;
const TIMERS = [0, 30, 60, 90, 150];                     // seconds per draft pick (arranging gets double); 0 = no timer
const PRESENCE_MS = 24000;
const EMOTES = ['hello', 'wow', 'hmm', 'gg', 'oops', 'nice', 'hurry', 'thanks'];
const BOT_NAMES = ['Cog', 'Astra', 'Vesper', 'Quill', 'Helio', 'Nox', 'Sextant', 'Gimbal'];

const newCode = () => { let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; };
const cleanName = (s, fallback = 'Astronomer') => {
  const n = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || fallback;
};
const cleanTimer = t => (TIMERS.includes(+t) ? +t : 60);
const uniqueName = (room, name) => {
  let n = name, i = 2; const taken = x => room.players.some(p => p.name.toLowerCase() === x.toLowerCase());
  while (taken(n)) n = name.slice(0, 13) + ' ' + i++;
  return n;
};

function makeRoom(code, name, tokens, now, timer) {
  const room = {
    code, v: 1, created: now, updated: now, hostId: 'p1', nextPid: 2, settings: { timer: cleanTimer(timer) },
    players: [{ id: 'p1', name: cleanName(name), bot: false, left: false }], game: null, chat: [], chatN: 0, lastEmote: {}
  };
  return { room, pid: 'p1', token: tokens.sign(code, 'p1') };
}

function join(room, name, tokens, now) {
  if (room.game) return { ok: false, error: 'That game has already started.' };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'That room is full.' };
  const pid = 'p' + room.nextPid++;
  room.players.push({ id: pid, name: uniqueName(room, cleanName(name)), bot: false, left: false });
  return { ok: true, pid, token: tokens.sign(room.code, pid) };
}

const playerOf = (room, pid) => room.players.find(p => p.id === pid && !p.left) || null;
const isHost = (room, pid) => room.hostId === pid;
const humans = room => room.players.filter(p => !p.bot && !p.left);

function startGame(room, now) {
  const pids = room.players.map(p => p.id);
  room.game = E.newGame(pids, { timer: room.settings.timer, bots: room.players.filter(p => p.bot).map(p => p.id), now });
  E.settle(room.game, now);
}

function reassignHost(room) {
  const h = humans(room)[0];
  if (h) room.hostId = h.id;
}

function leave(room, pid, now) {
  const p = playerOf(room, pid); if (!p) return;
  if (!room.game) room.players = room.players.filter(x => x.id !== pid);
  else {
    p.left = true; room.game.bot[pid] = true;
    if (room.game.phase !== 'over') { room.game.log.push({ n: ++room.game.logSeq, k: 'left', p: pid }); E.settle(room.game, now); }
  }
  if (room.hostId === pid) reassignHost(room);
}

/* Apply one authenticated player action. Returns { ok, error? }. */
function apply(room, pid, ev, data, now) {
  const g = room.game, me = playerOf(room, pid);
  if (!me) return { ok: false, error: 'You are not in this room.' };
  const bad = error => ({ ok: false, error });
  data = data && typeof data === 'object' ? data : {};

  if (g && g.bot[pid] && !me.bot && ['pick', 'decree', 'lock', 'loadout'].includes(ev)) g.bot[pid] = false;   // coming back from autopilot

  switch (ev) {
    case 'cfg': {
      if (!isHost(room, pid)) return bad('Only the host can change settings.');
      if (g) return bad('The game has already started.');
      if (data.timer !== undefined) room.settings.timer = cleanTimer(data.timer);
      return { ok: true };
    }
    case 'bot': {
      if (!isHost(room, pid)) return bad('Only the host can do that.');
      if (g) return bad('The game has already started.');
      if (data.remove) {
        const b = room.players.find(p => p.id === data.remove && p.bot); if (!b) return bad('No such bot.');
        room.players = room.players.filter(p => p !== b); return { ok: true };
      }
      if (room.players.length >= MAX_PLAYERS) return bad('The room is full.');
      const used = new Set(room.players.map(p => p.name)), nm = BOT_NAMES.find(n => !used.has(n)) || 'Familiar ' + room.nextPid;
      room.players.push({ id: 'p' + room.nextPid++, name: nm, bot: true, left: false });
      return { ok: true };
    }
    case 'kick': {
      if (!isHost(room, pid)) return bad('Only the host can do that.');
      if (g) return bad('You can only remove players in the lobby.');
      const t = room.players.find(p => p.id === data.pid && p.id !== pid); if (!t) return bad('No such player.');
      room.players = room.players.filter(p => p !== t); return { ok: true };
    }
    case 'start': {
      if (!isHost(room, pid)) return bad('Only the host can start the game.');
      if (g) return bad('Already started.');
      if (room.players.length < MIN_PLAYERS) return bad('You need at least 2 players. Add a bot to play solo.');
      startGame(room, now); return { ok: true };
    }
    case 'again': {
      if (!isHost(room, pid)) return bad('Only the host can start a rematch.');
      if (!g || g.phase !== 'over') return bad('The game is not over.');
      room.players = room.players.filter(p => !p.left); room.game = null; return { ok: true };
    }
    case 'leave': leave(room, pid, now); return { ok: true };
    case 'botify': {      // host hands a stalled human's seat to the autopilot
      if (!isHost(room, pid) || !g) return bad('Only the host can do that during a game.');
      const t = room.players.find(p => p.id === data.pid && !p.left && !p.bot && p.id !== pid); if (!t) return bad('No such player.');
      g.bot[t.id] = true; E.settle(g, now); return { ok: true };
    }
    case 'emote': {
      if (!EMOTES.includes(data.id)) return bad('Unknown emote.');
      if (now - (room.lastEmote[pid] || 0) < 900) return bad('Slow down!');
      room.lastEmote[pid] = now;
      room.chat.push({ n: ++room.chatN, pid, id: data.id, t: now }); if (room.chat.length > 14) room.chat.shift();
      return { ok: true };
    }
    case 'loadout': case 'pick': case 'decree': case 'lock': {
      if (!g) return bad('The game has not started.');
      let r;
      if (ev === 'loadout') r = E.setLoadout(g, pid, data.ids, now);
      else if (ev === 'pick') r = E.pick(g, pid, data.die, now);
      else if (ev === 'decree') r = E.cast(g, pid, data, now);
      else r = E.lock(g, pid, data.assign, now);
      if (r.ok) E.settle(g, now);
      return r;
    }
    default: return bad('Unknown action.');
  }
}

/* Advance timers (auto-play, reveal pause). Returns true if anything changed. */
function tick(room, now) {
  if (!room.game) return false;
  const c = E.tick(room.game, now);
  if (c) E.settle(room.game, now);
  return c;
}

function view(room, pid, presence, now) {
  presence = presence || {};
  const g = room.game;
  return {
    v: room.v, code: room.code, you: pid, host: room.hostId, now, settings: room.settings,
    players: room.players.map((p, i) => ({
      id: p.id, name: p.name, seat: i, bot: !!p.bot, left: !!p.left,
      auto: !!(g && g.bot[p.id] && !p.bot), connected: p.bot ? true : !!(presence[p.id] && now - presence[p.id] < PRESENCE_MS)
    })),
    game: g ? E.publicView(g, pid) : null,
    chat: room.chat
  };
}

module.exports = { newCode, cleanName, cleanTimer, makeRoom, join, apply, tick, view, playerOf, humans, EMOTES, TIMERS, MAX_PLAYERS, PRESENCE_MS };
