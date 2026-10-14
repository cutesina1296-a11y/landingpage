'use strict';

const path = require('node:path');
const express = require('express');

const app = express();
const projectRoot = path.resolve(__dirname, '..');

app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.path.split('/').some(segment => segment.startsWith('.')) ||
      req.path === '/backend' || req.path.startsWith('/backend/')) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(projectRoot, {
  dotfiles: 'deny',
  index: 'index.html',
  fallthrough: false
}));
app.use((error, req, res, next) => {
  if (error.status === 404) return res.sendStatus(404);
  console.error('[SITE] Request failed:', error);
  res.sendStatus(500);
});

const port = Number(process.env.SITE_PORT) || 5500;
app.listen(port, '127.0.0.1', () => {
  console.log(`[SITE] Serving local website at http://127.0.0.1:${port}`);
});
