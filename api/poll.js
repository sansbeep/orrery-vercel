const app = require('../lib/vercel-app.js');
module.exports = (req, res) => app.http(req, res);
