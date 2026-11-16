/* ORRERY effects: drifting star-field with faint orbit rings, and tiny synthesised sound effects (no audio files). */
(function () {
  'use strict';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- star-field ---------- */
  function startStars(canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, stars = [], rings = [], shoot = null, last = 0, running = true;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.width = Math.floor(innerWidth * dpr); h = canvas.height = Math.floor(innerHeight * dpr);
      canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
      const n = Math.floor((innerWidth * innerHeight) / 5200);
      stars = Array.from({ length: Math.min(260, n) }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.2 + 0.25) * dpr,
        a: Math.random() * 0.6 + 0.25, tw: Math.random() * 2 + 0.6, ph: Math.random() * 6.28, dx: (Math.random() * 0.012 + 0.004) * dpr,
        hue: Math.random() < 0.18 ? 42 : Math.random() < 0.3 ? 215 : 0
      }));
      rings = [0.34, 0.52, 0.74].map((k, i) => ({ r: Math.max(w, h) * k, sp: (0.012 + i * 0.006) * (i % 2 ? -1 : 1), ang: Math.random() * 6.28, tilt: 0.38 + i * 0.07 }));
    }
    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      ctx.clearRect(0, 0, w, h);
      // faint orbit rings with a small planet on each — the orrery behind everything
      ctx.save(); ctx.translate(w * 0.5, h * 0.46);
      rings.forEach((rg, i) => {
        rg.ang += rg.sp * dt;
        ctx.save(); ctx.scale(1, rg.tilt); ctx.beginPath(); ctx.arc(0, 0, rg.r, 0, 6.283);
        ctx.strokeStyle = 'rgba(201,168,106,' + (0.07 - i * 0.012) + ')'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
        const px = Math.cos(rg.ang) * rg.r, py = Math.sin(rg.ang) * rg.r;
        ctx.beginPath(); ctx.arc(px, py, (3.2 - i * 0.5) * dpr, 0, 6.283);
        ctx.fillStyle = ['rgba(92,200,255,.55)', 'rgba(255,111,145,.5)', 'rgba(110,231,183,.5)'][i]; ctx.fill(); ctx.restore();
      });
      ctx.restore();
      for (const s of stars) {
        s.x += s.dx; if (s.x > w) s.x = 0;
        const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(t / 1000 * s.tw + s.ph);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283);
        ctx.fillStyle = s.hue ? 'hsla(' + s.hue + ',90%,80%,' + s.a * tw + ')' : 'rgba(236,230,211,' + s.a * tw + ')'; ctx.fill();
      }
      if (!reduce) {
        if (!shoot && Math.random() < 0.0016) shoot = { x: Math.random() * w * 0.8, y: Math.random() * h * 0.4, vx: (6 + Math.random() * 5) * dpr, vy: (2.4 + Math.random() * 2) * dpr, life: 1 };
        if (shoot) {
          const s = shoot; s.x += s.vx; s.y += s.vy; s.life -= 0.022;
          const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 9, s.y - s.vy * 9);
          g.addColorStop(0, 'rgba(255,244,200,' + s.life * 0.9 + ')'); g.addColorStop(1, 'rgba(255,244,200,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.4 * dpr; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 9, s.y - s.vy * 9); ctx.stroke();
          if (s.life <= 0) shoot = null;
        }
      }
      requestAnimationFrame(frame);
    }
    resize(); addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
    requestAnimationFrame(frame);
  }

  /* ---------- sound ---------- */
  let ac = null, master = null, muted = false;
  try { muted = localStorage.getItem('orrery.muted') === '1'; } catch (e) { /* storage blocked */ }
  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ac = new AC(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, t0, dur, type = 'sine', vol = 0.2, f2) {
    const c = ctx(); if (!c || muted) return;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, c.currentTime + t0 + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g); g.connect(master); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  function click(t0 = 0, vol = 0.25) {            // a dry wooden "clack" from filtered noise
    const c = ctx(); if (!c || muted) return;
    const len = 0.05, buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 900; bp.Q.value = 1.1;
    const g = c.createGain(); g.gain.value = vol; src.connect(bp); bp.connect(g); g.connect(master); src.start(c.currentTime + t0);
  }
  const SFX = {
    roll() { for (let i = 0; i < 6; i++) click(i * 0.055 + Math.random() * 0.02, 0.16 + Math.random() * 0.12); },
    pick() { click(0, 0.3); tone(260, 0, 0.1, 'triangle', 0.08, 180); },
    place() { click(0, 0.22); tone(320, 0.01, 0.08, 'sine', 0.07); },
    lock() { tone(196, 0, 0.18, 'triangle', 0.16); tone(294, 0.09, 0.28, 'triangle', 0.14); click(0.09, 0.2); },
    reveal() { tone(280, 0, 0.7, 'sawtooth', 0.05, 900); tone(420, 0.05, 0.7, 'triangle', 0.07, 1300); for (let i = 0; i < 5; i++) click(0.1 + i * 0.09, 0.14); },
    claim() { tone(660, 0, 1.2, 'sine', 0.16); tone(990, 0, 1.0, 'sine', 0.08); tone(1320, 0.02, 0.8, 'sine', 0.05); },
    eclipse() { tone(110, 0, 0.9, 'sine', 0.18, 70); tone(55, 0, 1, 'sine', 0.12); },
    cast() { tone(520, 0, 0.35, 'triangle', 0.12, 1040); tone(780, 0.06, 0.4, 'sine', 0.09, 1560); },
    turn() { tone(740, 0, 0.16, 'sine', 0.12); tone(988, 0.1, 0.22, 'sine', 0.1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => { tone(f, i * 0.13, 0.55, 'triangle', 0.14); tone(f * 2, i * 0.13, 0.4, 'sine', 0.05); }); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, i * 0.2, 0.5, 'triangle', 0.12)); },
    error() { tone(150, 0, 0.18, 'square', 0.06); }
  };
  window.FX = {
    startStars,
    sfx(name) { try { const f = SFX[name]; if (f) f(); } catch (e) { /* audio is optional */ } },
    get muted() { return muted; },
    setMuted(m) { muted = !!m; try { localStorage.setItem('orrery.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ } },
    unlock() { ctx(); }
  };
})();
