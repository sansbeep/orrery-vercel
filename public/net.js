/* ORRERY networking — three tiers, picked automatically, one interface.
 *
 *   1. Socket.IO      WebSocket, or Socket.IO's own long-polling when a network blocks WebSocket upgrades (Node hosts).
 *                     On Vercel the Socket.IO function only speaks WebSocket (its long-polling can't work across serverless
 *                     instances), so the client is told `wsOnly` by /api/health and asks for the websocket transport.
 *   2. HTTP polling   If Socket.IO can't connect (or keeps dropping), the client falls back to /api/rpc + /api/poll —
 *                     plain stateless HTTP that works through any proxy, antivirus filter, and on Vercel.
 *
 *   const net = new Net({ state(view), status(s), gone(msg) });   await net.boot();   await net.rpc('pick', {die});
 */
(function () {
  'use strict';
  const cfg = window.ORRERY_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const BASE = String(qs.get('server') || cfg.server || '').replace(/\/+$/, '');
  const FORCE_HTTP = qs.get('net') === 'http';
  const KEY = 'orrery.session';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fetchJson(url, init = {}, timeout = 8000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, Object.assign({ signal: ctl.signal, cache: 'no-store' }, init));
      return await res.json();
    } finally { clearTimeout(t); }
  }
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const save = s => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

  class Net {
    constructor(h) {
      this.h = h; this.mode = 'connecting'; this.online = false; this.health = null; this.session = load();
      this.v = 0; this.sock = null; this.polling = false; this.pc = 0; this.failures = 0; this.fallbackT = null; this.hbT = null; this.serverOffset = 0;
    }

    /* ---- status ---- */
    setStatus(mode, online, detail) {
      this.mode = mode; this.online = online;
      this.h.status && this.h.status({ mode, online, detail: detail || '', health: this.health });
    }

    /* ---- boot: probe, then pick the best transport ---- */
    async boot() {
      this.setStatus('connecting', false);
      try { this.health = await fetchJson(BASE + '/api/health', {}, 4500); } catch (e) { this.health = null; }
      if (FORCE_HTTP || (this.health && this.health.socket === false)) return this.startHttp();
      const ok = await this.startSocket(this.health || { socketPath: '/socket.io', wsOnly: false });
      if (!ok) await this.startHttp();
    }

    /* ---- tier 1: Socket.IO ---- */
    startSocket(h) {
      return new Promise(resolve => {
        if (typeof io !== 'function') return resolve(false);
        let settled = false, errors = 0;
        const done = v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
        const sock = io(BASE || undefined, {
          path: h.socketPath || '/socket.io',
          transports: h.wsOnly ? ['websocket'] : ['polling', 'websocket'],   // polling first (always works), then upgrade
          reconnection: true, reconnectionDelay: 600, reconnectionDelayMax: 4000, timeout: 6500
        });
        this.sock = sock;
        const timer = setTimeout(() => { if (!settled) { sock.close(); done(false); } }, 8000);
        const label = () => (sock.io.engine && sock.io.engine.transport.name === 'websocket') ? 'ws' : 'sio-poll';
        sock.on('connect', async () => {
          clearTimeout(this.fallbackT); this.failures = 0;
          this.setStatus(label(), true);
          sock.io.engine.on('upgrade', () => this.setStatus(label(), true));
          this.startHeartbeat();
          if (this.session) await this.rejoin();
          done(true);
        });
        sock.on('connect_error', () => {
          errors++;
          if (!settled && errors >= 2) { sock.close(); done(false); }
        });
        sock.on('disconnect', () => {
          if (this.mode === 'http') return;
          this.setStatus('reconnecting', false);
          clearTimeout(this.fallbackT);
          this.fallbackT = setTimeout(() => { if (!sock.connected) { sock.close(); this.startHttp(); } }, 15000);   // never stay stuck: drop to HTTP
        });
        sock.on('state', v => this.deliver(v));
        sock.on('gone', () => { this.clearSession(); this.h.gone && this.h.gone('That room has expired.'); });
      });
    }

    startHeartbeat() {
      clearInterval(this.hbT);
      this.hbT = setInterval(() => { if (this.sock && this.sock.connected && this.session) this.sock.emit('rpc', { ev: 'hb' }, () => {}); }, 9000);
    }

    async rejoin() {
      const s = this.session; if (!s) return { ok: false };
      const res = await this.rpc('rejoin', {}, { code: s.code, token: s.token });
      if (!res.ok && (res.auth || res.gone)) { this.clearSession(); this.h.gone && this.h.gone(res.error || 'That session has ended.'); }
      return res;
    }

    /* ---- tier 2: HTTP polling ---- */
    async startHttp() {
      if (this.sock) { try { this.sock.close(); } catch (e) { /* ignore */ } this.sock = null; }
      clearInterval(this.hbT); clearTimeout(this.fallbackT);
      this.setStatus('http', true);
      if (this.session) this.rejoin();
      this.pollLoop();
    }

    async pollLoop() {
      if (this.polling) return; this.polling = true;
      while (this.mode === 'http' || this.mode === 'http-offline') {
        const s = this.session;
        if (!s) { await sleep(450); continue; }
        this.pc++;
        const q = new URLSearchParams({ code: s.code, token: s.token, v: this.v });
        if (this.pc % 4 === 0) q.set('hb', '1');
        if (this.pc % 3 === 0) q.set('p', '1');
        try {
          const j = await fetchJson(BASE + '/api/poll?' + q, {}, 9000);
          if (this.mode === 'http-offline') this.setStatus('http', true);
          this.failures = 0;
          if (j.ok) { if (!j.same) this.deliver(j.view); else if (j.conn && this.h.conn) this.h.conn(j.conn); }
          else if (j.auth || j.gone) { this.clearSession(); this.h.gone && this.h.gone(j.error); }
        } catch (e) {
          if (++this.failures >= 3 && this.mode === 'http') this.setStatus('http-offline', false);
        }
        await sleep(this.failures ? Math.min(5000, 700 * this.failures) : document.hidden ? 3500 : 1100);
      }
      this.polling = false;
    }

    /* ---- shared ---- */
    deliver(view) {
      if (!view || view.v < this.v) return;                    // never go back in time
      this.v = view.v; this.serverOffset = view.now - Date.now();
      this.h.state && this.h.state(view);
    }
    clearSession() { this.session = null; this.v = 0; save(null); }
    setSession(code, token) { if (!this.session || this.session.code !== code) this.v = 0; this.session = { code, token }; save(this.session); }

    async rpc(ev, data = {}, extra = {}) {
      let res;
      if (this.mode === 'ws' || this.mode === 'sio-poll' || this.mode === 'reconnecting') res = await this.sockRpc(ev, data, extra);
      else res = await this.httpRpc(ev, data, extra);
      if (res && res.ok && (ev === 'create' || ev === 'join') && res.token) this.setSession(res.code, res.token);
      if (res && res.ok && ev === 'leave') this.clearSession();
      if (res && !res.ok && res.auth && ev !== 'rejoin') { this.clearSession(); this.h.gone && this.h.gone(res.error); }
      return res;
    }

    sockRpc(ev, data, extra) {
      return new Promise(resolve => {
        const s = this.sock;
        if (!s || !s.connected) return resolve({ ok: false, error: 'Reconnecting… try again in a moment.' });
        const t = setTimeout(() => resolve({ ok: false, error: 'The server took too long to answer.' }), 9000);
        s.emit('rpc', Object.assign({ ev, data }, extra), res => { clearTimeout(t); resolve(res || { ok: false, error: 'No answer.' }); });
      });
    }

    async httpRpc(ev, data, extra, retry = true) {
      const s = this.session;
      const body = Object.assign({ ev, data, code: s ? s.code : undefined, token: s ? s.token : undefined }, extra);
      try {
        const res = await fetchJson(BASE + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10000);
        if (!res.ok && res.busy && retry) { await sleep(300); return this.httpRpc(ev, data, extra, false); }
        if (res.view) {
          if (res.ok && (ev === 'create' || ev === 'join') && res.token) this.setSession(res.code, res.token);
          this.deliver(res.view); delete res.view;
        }
        return res;
      } catch (e) {
        return { ok: false, error: 'Connection lost. Check your internet and try again.' };
      }
    }

    /* seconds-accurate "now" on the server's clock */
    serverNow() { return Date.now() + this.serverOffset; }
  }

  window.Net = Net;
})();
