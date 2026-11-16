/* ORRERY — shared rules (runs in Node and in the browser).
 * One source of truth for Laws (House rules), Decrees (cards) and scoring, so the live
 * score previews in the client always agree with the server's judgement. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrreryRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUSES = 5;       // lanes on the table
  const SLOTS = 3;        // dice each player places in each House
  const WATCHES = 5;      // rounds; 5 Watches x 3 dice = the 15 slots each player owns
  const WIN_HOUSES = 3;   // claim a majority of Houses to win outright
  const LOADOUT = 4;      // Decrees each player brings (chosen from 8)
  const DICE_EACH = 3;    // dice drafted per player per Watch

  const sum = a => a.reduce((x, y) => x + y, 0);
  const desc = a => a.slice().sort((x, y) => y - x);
  const top = (a, i) => (desc(a)[i] || 0);

  /* A Law turns a player's dice in one House into a comparable `key` (higher is better,
   * compared left-to-right) plus display text. Works on partial Houses too (for previews). */
  const LAWS = {
    sol: {
      id: 'sol', name: 'Sol', epithet: 'The Greater Sum', hue: 44,
      text: 'Highest total wins.',
      rank(d) { const s = sum(d); return { key: [s, top(d, 0), top(d, 1)], val: s, label: String(s), note: '' }; }
    },
    luna: {
      id: 'luna', name: 'Luna', epithet: 'The Lesser Sum', hue: 222,
      text: 'Lowest total wins.',
      rank(d) { const s = sum(d); return { key: [-s, -top(d, 0)], val: s, label: String(s), note: '' }; }
    },
    mercury: {
      id: 'mercury', name: 'Mercury', epithet: 'The Mean', hue: 168,
      text: 'Closest total to 10 wins.',
      rank(d) {
        const s = sum(d), off = Math.abs(s - 10);
        return { key: [-off, top(d, 0)], val: s, label: String(s), note: off === 0 ? 'exact' : off + ' off' };
      }
    },
    venus: {
      id: 'venus', name: 'Venus', epithet: 'The Run', hue: 330,
      text: 'Total, plus 5 for every pair of dice exactly 1 apart.',
      rank(d) {
        let links = 0;
        for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (Math.abs(d[i] - d[j]) === 1) links++;
        const v = sum(d) + 5 * links;
        return { key: [v, top(d, 0)], val: v, label: String(v), note: links ? '+' + 5 * links + ' run' : '' };
      }
    },
    mars: {
      id: 'mars', name: 'Mars', epithet: 'The Champion', hue: 6,
      text: 'Only your single highest die counts.',
      rank(d) { const m = top(d, 0); return { key: [m, sum(d)], val: m, label: String(m), note: '' }; }
    },
    jupiter: {
      id: 'jupiter', name: 'Jupiter', epithet: 'The Even', hue: 22,
      text: 'Only even dice count. Highest total wins.',
      rank(d) { const e = sum(d.filter(x => x % 2 === 0)); return { key: [e, sum(d)], val: e, label: String(e), note: '' }; }
    },
    saturn: {
      id: 'saturn', name: 'Saturn', epithet: 'The Limit', hue: 84,
      text: 'Highest total wins, but a total over 13 is a bust.',
      rank(d) {
        const s = sum(d);
        if (s > 13) return { key: [0, -s], val: 0, label: 'BUST', note: s + ' > 13', bust: true };
        return { key: [s, 0], val: s, label: String(s), note: '' };
      }
    },
    neptune: {
      id: 'neptune', name: 'Neptune', epithet: 'The Odd', hue: 196,
      text: 'Only odd dice count. Highest total wins.',
      rank(d) { const o = sum(d.filter(x => x % 2 === 1)); return { key: [o, sum(d)], val: o, label: String(o), note: '' }; }
    },
    pluto: {
      id: 'pluto', name: 'Pluto', epithet: 'The Echo', hue: 280,
      text: 'Matching dice count double. Highest total wins.',
      rank(d) {
        let v = 0, echo = false;
        for (const x of d) { const c = d.filter(y => y === x).length; v += c > 1 ? 2 * x : x; if (c > 1) echo = true; }
        return { key: [v, top(d, 0)], val: v, label: String(v), note: echo ? 'echo x2' : '' };
      }
    }
  };
  const LAW_IDS = Object.keys(LAWS);

  /* Decrees: one-use cards. A player may cast at most ONE per Watch.
   * when: 'draft' = only on your own draft turn, 'arrange' = only while arranging, 'any' = either. */
  const DECREES = {
    tilt:    { id: 'tilt',    name: 'Tilt',    when: 'any',     text: 'Nudge one of your dice up or down by 1.' },
    mirror:  { id: 'mirror',  name: 'Mirror',  when: 'any',     text: 'Flip one of your dice to its opposite face (1↔6, 2↔5, 3↔4).' },
    shift:   { id: 'shift',   name: 'Shift',   when: 'any',     text: 'Move one of your revealed dice to an empty slot in another open House.' },
    reforge: { id: 'reforge', name: 'Reforge', when: 'draft',   text: 'Re-roll one die in the Well.' },
    wish:    { id: 'wish',    name: 'Wish',    when: 'draft',   text: 'Take any die from the Well and set it to any face you like.' },
    hex:     { id: 'hex',     name: 'Hex',     when: 'draft',   text: "Re-roll one of an opponent's revealed dice in an open House." },
    eclipse: { id: 'eclipse', name: 'Eclipse', when: 'draft',   text: 'Swap the Laws of two open Houses. Dice stay where they are.' },
    scry:    { id: 'scry',    name: 'Scry',    when: 'arrange', text: 'Once an opponent has locked in, see how they placed their dice in one House.' }
  };
  const DECREE_IDS = Object.keys(DECREES);

  function cmpKey(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y ? 1 : -1; }
    return 0;
  }

  /* Judge one House. hands = { pid: [values...] }. Returns the winner (or null on an exact tie, i.e. an
   * "eclipsed" House), every player's score, and the margin of victory. */
  function judge(lawId, hands) {
    const law = LAWS[lawId], pids = Object.keys(hands), scores = {};
    for (const p of pids) scores[p] = law.rank(hands[p]);
    const order = pids.slice().sort((a, b) => cmpKey(scores[b].key, scores[a].key));
    const best = order[0], second = order[1];
    const tie = second !== undefined && cmpKey(scores[best].key, scores[second].key) === 0;
    const margin = second === undefined ? 0 : Math.abs(scores[best].key[0] - scores[second].key[0]);
    return { winner: tie ? null : best, tie, scores, order, margin };
  }

  /* The snake draft order for one Watch: A B | B A | A B (each pass is one die each). */
  function snake(seq) {
    const out = [];
    for (let r = 0; r < DICE_EACH; r++) out.push(...(r % 2 ? seq.slice().reverse() : seq));
    return out;
  }

  return { HOUSES, SLOTS, WATCHES, WIN_HOUSES, LOADOUT, DICE_EACH, LAWS, LAW_IDS, DECREES, DECREE_IDS, judge, cmpKey, snake };
});
