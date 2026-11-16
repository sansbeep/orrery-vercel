'use strict';
/* Stateless player tokens: "<pid>.<signature>". The signature is an HMAC of room code + pid, so any server
 * instance (Vercel function, Render, your laptop) can verify a token without a database lookup. This is what lets
 * the HTTP polling endpoint authenticate a player with zero Redis reads. */
const crypto = require('crypto');

function makeTokens(secret) {
  const sig = (code, pid) => crypto.createHmac('sha256', secret).update(code + ':' + pid).digest('base64url').slice(0, 24);
  return {
    sign: (code, pid) => pid + '.' + sig(code, pid),
    /* returns the pid, or null if the token is forged / malformed */
    verify(code, token) {
      if (typeof token !== 'string' || token.length > 60) return null;
      const i = token.indexOf('.'); if (i < 1) return null;
      const pid = token.slice(0, i), want = sig(code, pid), got = token.slice(i + 1);
      if (got.length !== want.length) return null;
      return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)) ? pid : null;
    }
  };
}
module.exports = { makeTokens };
