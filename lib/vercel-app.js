'use strict';
/* One shared app per Vercel function instance. On Vercel, rooms MUST live in Redis (see README):
 * functions are stateless and many instances run at once, so an in-memory store would lose rooms. */
const { createApp } = require('./app.js');
module.exports = createApp({ mode: 'vercel', socketPath: '/api/socket-io/socket.io', wsOnly: true });
