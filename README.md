# ORRERY

A multiplayer dice-and-decree strategy duel for 2–4 players (or you against clockwork bots). Easy to learn in one game, deep enough to keep bluffing for a hundred.

Built with **Socket.IO**, which automatically falls back to **plain HTTP polling** if WebSockets are blocked. Runs on a normal Node host (Render, Railway, Fly, a VPS) **or on Vercel**.

---

## How to play (the 60-second version)

Five **Houses** sit on the table. Each is ruled by a planet's **Law** that decides who wins it (5 of 9 Laws are drawn each game). **Claim 3 Houses to win.**

A game is five **Watches** (rounds). Each Watch:

1. **Draft.** Dice are rolled into the **Well**. Take turns picking one, snake order (A B · B A · A B). Every pick is public. You end up with 3 dice. Whoever is behind drafts first.
2. **Arrange.** In secret, place your 3 dice into open slots (each House has 3 slots per player), then **Lock In**.
3. **Reveal.** All dice flip at once. Any House where *every* player has filled all 3 slots is judged by its Law. Best hand claims it. An exact tie **Eclipses** the House: nobody gets it.

Before the game you pick **4 of 8 Decrees**: secret, one-use cards (max one per Watch) that bend dice, steal information or rewrite a House's Law. Opponents see how many you have left, never which.

| Law | Rule |
|---|---|
| Sol | Highest total |
| Luna | Lowest total |
| Mercury | Closest total to 10 |
| Venus | Total, +5 per pair of dice exactly 1 apart |
| Mars | Only your single highest die counts |
| Jupiter | Only even dice count |
| Saturn | Highest total, but over 13 is a bust |
| Neptune | Only odd dice count |
| Pluto | Matching dice count double |

| Decree | Effect | When |
|---|---|---|
| Tilt | Nudge one of your dice by ±1 | any |
| Mirror | Flip a die to its opposite face (7 − v) | any |
| Shift | Move one of your revealed dice to an empty slot in another open House | any |
| Reforge | Re-roll a die in the Well | your draft turn |
| Wish | Take any Well die and set it to any face | your draft turn |
| Hex | Re-roll an opponent's revealed die in an open House | your draft turn |
| Eclipse | Swap the Laws of two open Houses | your draft turn |
| Scry | See how a locked-in opponent placed their dice in one House | arranging |

If nobody has 3 Houses after Watch 5, most Houses wins; ties go to the larger total margin of victory.

---

## Run it locally / on a Node host (recommended)

```bash
npm install
npm start          # http://localhost:8080  (prints your LAN address too)
```

Set `PORT` if you need a different one. To play with friends on the same Wi-Fi, give them the "Same Wi-Fi" address it prints.

**Render:** New → Web Service → connect the repo. Build command `npm install`, start command `npm start`. That's it, rooms live in memory (fine for one instance).

The client tries Socket.IO first (polling → WebSocket upgrade, same as Blockfront). If your network blocks WebSocket it stays on Socket.IO long-polling; if Socket.IO itself can't connect it drops to the HTTP API. The pill in the top bar shows which one you're on: **Live** (WebSocket), **Live · polling** or **Live · HTTP**.

---

## Deploy on Vercel

Vercel functions are stateless and can't hold Socket.IO long-polling sessions, so on Vercel ORRERY uses a three-part setup that is chosen automatically:

| Piece | What it is |
|---|---|
| `api/socket-io.js` | Socket.IO over **WebSocket only** (Vercel's WebSocket support, currently in beta) |
| `api/rpc.js`, `api/poll.js` | Stateless HTTP API, the fallback that works on any network |
| Redis | Shared room storage, **required** on Vercel |

**Steps**

1. Push this folder to a Git repo and import it in Vercel (no framework preset, no build command; `vercel.json` already sets this up).
2. In the Vercel dashboard open **Storage / Marketplace** and add a Redis (for example **Upstash Redis**). Connect it to the project; Vercel injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) for you. `REDIS_URL` also works.
3. Redeploy. Open `/api/health`; it should say `"persistent": true`.

Without Redis the game still starts, but the menu shows a warning, because separate serverless instances don't share memory and rooms can vanish mid-game.

**Honest caveats**
- I could test the Vercel layout only by simulation (isolated function instances + a real Redis), not on a live Vercel account. If Vercel's WebSocket beta isn't enabled for your project, players simply land on the HTTP fallback, which is slightly slower (about 1 s per update) but fully playable.
- WebSocket connections on Vercel are capped by `maxDuration` (300 s in `vercel.json`). The client reconnects on its own and your seat is kept.

### Vercel frontend + Render backend (alternative)
Host the pages on Vercel but run `npm start` on Render, then set `public/config.js` to
`window.ORRERY_CONFIG = { server: 'https://your-app.onrender.com' };`
(or open the page with `?server=https://your-app.onrender.com`). CORS is already open.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Port for `npm start` (default 8080) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Redis over REST (Vercel Marketplace / Upstash) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Same, Vercel KV naming |
| `REDIS_URL` | Redis over TCP (Render Key Value, Railway, self-hosted) |
| `ORRERY_SECRET` | Optional token-signing secret (otherwise derived from the Redis credentials, or random in memory mode) |
| `ORRERY_REVEAL_MS` | Pause after each reveal (default 4800) |
| `ORRERY_BOT_SAMPLES` | Bot simulation depth (default 56; lower = faster/weaker) |

---

## Project layout

```
server.js            Node host: static files + Socket.IO + HTTP API
api/                 Vercel functions (socket-io, rpc, poll, health)
lib/engine.js        Pure game rules/state machine (JSON in, JSON out)
lib/bot.js           "Clockwork Familiar": Monte-Carlo bot, also the timeout autopilot
lib/service.js       Rooms, seats, host actions, presence
lib/rpc.js           One entry point for every action, whatever the transport
lib/store.js         Memory / Redis (REST or TCP) store with locking
lib/app.js           Socket.IO + HTTP wiring shared by Node and Vercel
public/              The client (rules.js is shared with the server)
test/                Engine sim + integration + Vercel simulation
```

```bash
npm test     # engine simulation, 77 integration checks (WebSocket, polling-only, HTTP-only, mixed rooms, Redis), Vercel sim
```
(The Redis tests need a `redis-server` binary on the machine.)

## Good to know

- Seats survive refreshes and disconnects (signed token in `localStorage`); a stalled player's seat can be handed to the autopilot by the host.
- Hidden placements are never sent to other clients, so peeking at the network tab won't reveal an opponent's plan.
- Turn timers: Off / 30 / 60 / 90 / 150 s per draft pick (arranging gets double). When time runs out the autopilot plays that step.
