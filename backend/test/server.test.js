'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, createToken, isValidImage, parseGroupLink, safeEqual, verifyToken } = require('../server');

test('accepts valid HTTPS group links and rejects insecure URLs', () => {
  assert.equal(parseGroupLink('https://t.me/example'), 'https://t.me/example');
  assert.throws(() => parseGroupLink('http://t.me/example'), /https:\/\//);
  assert.throws(() => parseGroupLink('not a URL'), /valid HTTPS/);
});

test('checks uploaded image signatures against their MIME types', () => {
  assert.equal(isValidImage({
    mimetype: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  }), true);
  assert.equal(isValidImage({
    mimetype: 'image/png',
    buffer: Buffer.from('not an image')
  }), false);
  assert.equal(isValidImage({
    mimetype: 'image/webp',
    buffer: Buffer.from('RIFF0000WEBPdata')
  }), true);
});

test('validates admin tokens and rejects tampered tokens', () => {
  const token = createToken('owner', 'a session secret long enough for testing');
  assert.equal(verifyToken(token, 'a session secret long enough for testing', 'owner'), true);
  assert.equal(verifyToken(`${token}x`, 'a session secret long enough for testing', 'owner'), false);
  assert.equal(verifyToken(token, 'a different secret', 'owner'), false);
});

test('compares credentials without accepting different lengths', () => {
  assert.equal(safeEqual('owner', 'owner'), true);
  assert.equal(safeEqual('owner', 'owners'), false);
});

test('serves public settings and protects admin settings with login', async t => {
  const settingsCollection = { findOne: async () => null };
  const app = createApp({
    db: {
      collection: () => settingsCollection,
      command: async () => ({ ok: 1 })
    },
    bucket: {},
    allowedOrigin: 'https://site.example',
    adminUsername: 'owner',
    adminPassword: 'test-password',
    sessionSecret: 'a session secret long enough for testing'
  });
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get('content-type'), /text\/html/);
  assert.match(await rootResponse.text(), /class="app-title">Money Hub/);

  const adminPageResponse = await fetch(`${baseUrl}/admin.html`);
  assert.equal(adminPageResponse.status, 200);
  assert.match(adminPageResponse.headers.get('content-type'), /text\/html/);

  const logoResponse = await fetch(`${baseUrl}/uploads/logo.png`);
  assert.equal(logoResponse.status, 200);
  assert.match(logoResponse.headers.get('content-type'), /image\/png/);

  const privateFileResponse = await fetch(`${baseUrl}/package.json`);
  assert.equal(privateFileResponse.status, 404);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true, database: 'connected' });

  const publicResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).groupLink, 'https://t.me/officialapplication76');

  const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/config`);
  assert.equal(unauthorizedResponse.status, 401);

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'test-password' })
  });
  assert.equal(loginResponse.status, 200);
  const { token } = await loginResponse.json();
  const adminResponse = await fetch(`${baseUrl}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(adminResponse.status, 200);
  assert.equal((await adminResponse.json()).groupLink, 'https://t.me/officialapplication76');
});
