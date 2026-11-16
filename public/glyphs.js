/* ORRERY glyphs — hand-drawn SVG so they look identical on every device (no font/emoji surprises). */
(function () {
  'use strict';
  const S = (inner, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`;

  const LAW = {
    sol: S('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" stroke-width="1.3"/>'),
    luna: S('<path d="M16 3.5A9 9 0 1 0 20.5 15 7 7 0 0 1 16 3.5Z"/>'),
    mercury: S('<circle cx="12" cy="10.2" r="3.6"/><path d="M8 3.6a4 4 0 0 0 8 0M12 13.8V21M8.6 18h6.8"/>'),
    venus: S('<circle cx="12" cy="9" r="4.7"/><path d="M12 13.7V21M8.6 17.6h6.8"/>'),
    mars: S('<circle cx="10" cy="14" r="5"/><path d="M13.6 10.4 20 4M15 4h5v5"/>'),
    jupiter: S('<path d="M5.5 7.2C5.5 3.6 11 3 11 7.2c0 3.2-3 5.4-5.8 7.3H19M15.2 8.2V21"/>'),
    saturn: S('<path d="M8 3.5v13M5 6.8h6M8 11c4.6-4.6 9.8-1.6 7.6 3.2-1.2 2.5-1.6 4.4.4 6"/>'),
    neptune: S('<path d="M5 4.5v4.5a7 7 0 0 0 14 0V4.5M12 3v18M8.4 17.6h7.2M3 6.8 5 4l2 2.8M17 6.8 19 4l2 2.8M10 6 12 3l2 3"/>'),
    pluto: S('<circle cx="12" cy="7.2" r="2.4"/><path d="M6.4 5.8c0 8.4 11.2 8.4 11.2 0M12 13.6V21M8.6 18h6.8"/>')
  };

  const DECREE = {
    tilt: S('<path d="M12 3.5 18.5 10H5.5Z"/><path d="M12 20.5 5.5 14h13Z"/>'),
    mirror: S('<path d="M3.2 6 10 12l-6.8 6Z"/><path d="M20.8 6 14 12l6.8 6Z"/><path d="M12 3.5v17" stroke-dasharray="2 2.2"/>'),
    shift: S('<path d="M4 8.5h13M13.5 5 17 8.5 13.5 12"/><path d="M20 15.5H7M10.5 12 7 15.5l3.5 3.5"/>'),
    reforge: S('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20.5 3.8v4.4h-4.4"/>'),
    wish: S('<path d="M12 2.8 14.1 9.9 21.2 12l-7.1 2.1L12 21.2 9.9 14.1 2.8 12l7.1-2.1Z"/>'),
    hex: S('<path d="M12 3.4l5.3 16.4L3.4 9.7h17.2L6.7 19.8Z"/><circle cx="12" cy="12.6" r="8.8" stroke-width="1.1"/>'),
    eclipse: S('<circle cx="12" cy="12" r="7.4"/><path d="M15.8 5.2a7.4 7.4 0 0 0 0 13.6 7.4 7.4 0 0 1 0-13.6Z" fill="currentColor"/>'),
    scry: S('<path d="M1.8 12C5.6 5.6 18.4 5.6 22.2 12 18.4 18.4 5.6 18.4 1.8 12Z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>')
  };

  const ICON = {
    star: S('<path d="M12 2.8l2.7 6 6.5.6-4.9 4.4 1.5 6.4L12 16.8 6.2 20.2l1.5-6.4L2.8 9.4l6.5-.6Z" fill="currentColor"/>'),
    crown: S('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5Z" fill="currentColor"/>'),
    lock: S('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    eye: S('<path d="M1.8 12C5.6 5.6 18.4 5.6 22.2 12 18.4 18.4 5.6 18.4 1.8 12Z"/><circle cx="12" cy="12" r="3"/>'),
    sound: S('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
    mute: S('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    help: S('<circle cx="12" cy="12" r="9"/><path d="M9.2 9.4a3 3 0 1 1 4.4 2.6c-1 .6-1.6 1.2-1.6 2.4M12 17.4v.1"/>'),
    exit: S('<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9M14 8l4 4-4 4M18 12H9"/>'),
    copy: S('<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    bot: S('<rect x="5" y="8" width="14" height="10" rx="2.5"/><path d="M12 8V4.5M9.5 13v.1M14.5 13v.1M3 12.5v2M21 12.5v2"/><circle cx="12" cy="3.6" r="1" fill="currentColor"/>'),
    x: S('<path d="M6 6l12 12M18 6 6 18"/>'),
    spark: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.4 2.4M15.6 15.6 18 18M6 18l2.4-2.4M15.6 8.4 18 6"/>'),
    wifi: S('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/>')
  };

  const LOGO = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><radialGradient id="lg-sun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff3c4"/><stop offset=".55" stop-color="#f5c95a"/><stop offset="1" stop-color="#b8802a"/></radialGradient></defs>
    <g fill="none" stroke="#c9a86a" stroke-width="1.1" opacity=".9">
      <ellipse cx="60" cy="60" rx="52" ry="52" stroke-dasharray="1 5" opacity=".6"/>
      <g class="orb o1"><circle cx="60" cy="60" r="44" opacity=".55"/><circle cx="104" cy="60" r="4.6" fill="#5cc8ff" stroke="none"/></g>
      <g class="orb o2"><ellipse cx="60" cy="60" rx="31" ry="31" opacity=".6"/><circle cx="60" cy="29" r="3.6" fill="#ff6f91" stroke="none"/></g>
      <g class="orb o3"><circle cx="60" cy="60" r="19" opacity=".65"/><circle cx="41" cy="60" r="2.8" fill="#6ee7b7" stroke="none"/></g>
    </g>
    <circle cx="60" cy="60" r="8.5" fill="url(#lg-sun)"/>
  </svg>`;

  window.OG = {
    law: id => LAW[id] || '', decree: id => DECREE[id] || '', icon: id => ICON[id] || '', logo: LOGO,
    LAW_IDS: Object.keys(LAW), DECREE_IDS: Object.keys(DECREE)
  };
})();
