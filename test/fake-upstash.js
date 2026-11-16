'use strict';
/* A stand-in for Upstash's REST API in front of a REAL redis-server, so the REST driver is tested against real Redis
 * semantics. Protocol: POST / with a JSON command array -> {"result":...}; POST /pipeline with an array of commands. */
const http = require('http');
const { createClient } = require('redis');

async function start(port, redisUrl, token = 'test-token') {
  const c = createClient({ url: redisUrl }); c.on('error', () => {}); await c.connect();
  const run = async cmd => { try { return { result: await c.sendCommand(cmd.map(String)) }; } catch (e) { return { error: String(e.message || e) }; } };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); return res.end('{"error":"Unauthorized"}'); }
    let b = ''; req.on('data', d => b += d);
    req.on('end', async () => {
      const body = JSON.parse(b || 'null'); let out;
      if (req.url.startsWith('/pipeline')) out = await Promise.all(body.map(run)); else out = await run(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(port, r));
  return { server, close: async () => { server.close(); await c.quit(); } };
}
module.exports = { start };
if (require.main === module) start(+(process.argv[2] || 7799), process.argv[3] || 'redis://127.0.0.1:6379').then(() => console.log('fake upstash up'));
