// ORRERY server — serves the game, runs rooms over Socket.IO, and exposes the HTTP-polling fallback API.
//   npm install   (once)      npm start
// Works on any Node host (Render, Railway, Fly, your laptop). For Vercel see README.md — there the same
// logic runs as functions in /api, with rooms stored in Redis.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { Server } = require('socket.io');   // Socket.IO: websocket when it can, plain HTTP long-polling when a network blocks upgrades
const { createApp } = require('./lib/app');

const PORT = +(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

const app = createApp({ mode: 'node', socketPath: '/socket.io', wsOnly: false });

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return app.http(req, res);
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  let rel = url === '/' || url === '' ? '/index.html' : url;
  try { rel = decodeURIComponent(rel); } catch (e) { res.writeHead(400); return res.end(); }
  const full = path.join(PUBLIC, path.normalize(rel));
  if (!full.startsWith(PUBLIC + path.sep) && full !== PUBLIC) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': full.includes(path.sep + 'vendor' + path.sep) ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  });
});

// polling first (it always works — antivirus filters and proxies often block WebSocket upgrades), then upgrade to
// a real WebSocket when the network allows it. Generous ping timeouts for slow links.
const io = new Server(server, { cors: { origin: '*' }, transports: ['polling', 'websocket'], pingTimeout: 60000, pingInterval: 25000, serveClient: false });
app.attachSocket(io);

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ORRERY server is up.  Rooms are stored: ' + app.store.kind + (app.store.persistent ? '' : ' (this process only)') + '\n');
  console.log('  This machine:  http://localhost:' + PORT);
  for (const ip of addresses()) console.log('  Same Wi-Fi:    http://' + ip + ':' + PORT);
  console.log('  (Hosted: players use the https address your host gives you.)\n');
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log('shutting down'); io.close(); server.close(); setTimeout(() => process.exit(0), 300); });
