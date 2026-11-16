/* Socket.IO over Vercel's WebSocket support (WebSocket transport only — Socket.IO's own long-polling cannot work
 * across serverless instances; the HTTP polling API in /api/poll + /api/rpc is the fallback instead).
 * The client connects to path /api/socket-io/socket.io  with  transports: ['websocket']. */
const http = require('http');
const { Server } = require('socket.io');
const app = require('../lib/vercel-app.js');

const server = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('ORRERY socket endpoint'); });
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket'], serveClient: false, pingInterval: 20000, pingTimeout: 25000 });

// Whether Vercel hands us the full original URL or one relative to this function, accept both.
const strip = req => { if (req.url && req.url.startsWith('/api/socket-io')) req.url = req.url.slice('/api/socket-io'.length) || '/'; };
server.prependListener('request', strip);
server.prependListener('upgrade', strip);

app.attachSocket(io);
module.exports = server;
module.exports.default = server;
