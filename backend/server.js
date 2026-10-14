'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const cors = require('cors');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { GridFSBucket, MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');

const DEFAULT_SETTINGS = {
  _id: 'site',
  groupLink: 'https://t.me/officialapplication76',
  logoId: null,
  screenshots: [null, null, null]
};
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidImage(file) {
  const bytes = file.buffer;
  if (file.mimetype === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (file.mimetype === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (file.mimetype === 'image/webp') {
    return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  if (file.mimetype === 'image/gif') {
    const signature = bytes.toString('ascii', 0, 6);
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  return false;
}

function createToken(username, secret) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token, secret, username) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.sub === username && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function parseGroupLink(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Enter a valid HTTPS group link.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTPS group link.');
  }
  if (url.protocol !== 'https:') throw new Error('The group link must start with https://.');
  return url.toString();
}

function createApp({ db, bucket, allowedOrigin, adminUsername, adminPassword, sessionSecret }) {
  const app = express();
  const settingsCollection = db.collection('site_settings');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE, files: 4, fields: 5, parts: 10 },
    fileFilter: (req, file, callback) => {
      if (!IMAGE_TYPES.has(file.mimetype)) return callback(new Error('Use a PNG, JPG, WebP, or GIF image.'));
      callback(null, true);
    }
  }).fields([
    { name: 'logo', maxCount: 1 },
    { name: 'screen1', maxCount: 1 },
    { name: 'screen2', maxCount: 1 },
    { name: 'screen3', maxCount: 1 }
  ]);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || origin === allowedOrigin) return callback(null, true);
      callback(new Error('Origin is not allowed.'));
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600
  }));
  app.use(express.json({ limit: '10kb' }));

  function requireAdmin(req, res, next) {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!verifyToken(token, sessionSecret, adminUsername)) {
      return res.status(401).json({ error: 'Please log in again.' });
    }
    next();
  }

  async function readSettings() {
    const settings = await settingsCollection.findOne({ _id: 'site' });
    if (!settings) return { ...DEFAULT_SETTINGS, screenshots: [...DEFAULT_SETTINGS.screenshots] };
    const screenshots = Array.isArray(settings.screenshots) ? settings.screenshots.slice(0, 3) : [];
    while (screenshots.length < 3) screenshots.push(null);
    return { ...DEFAULT_SETTINGS, ...settings, screenshots };
  }

  async function storeImage(file) {
    if (!isValidImage(file)) throw new Error(`"${file.originalname}" is not a valid ${file.mimetype} image.`);
    const stream = bucket.openUploadStream(file.originalname, {
      contentType: file.mimetype,
      metadata: { contentType: file.mimetype }
    });
    await pipeline(Readable.from(file.buffer), stream);
    return stream.id;
  }

  async function removeImages(ids) {
    for (const id of ids) {
      if (!id) continue;
      try {
        await bucket.delete(id);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  app.get('/', (req, res) => {
    res.json({
      service: 'Money Hub API',
      ok: true,
      health: '/api/health',
      admin: '/api/admin/login'
    });
  });

  app.get('/api/health', async (req, res, next) => {
    try {
      await db.command({ ping: 1 });
      res.json({ ok: true, database: 'connected' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/config', async (req, res, next) => {
    try {
      const settings = await readSettings();
      res.set('Cache-Control', 'no-store');
      res.json({
        groupLink: settings.groupLink,
        logoId: settings.logoId ? settings.logoId.toString() : null,
        screenshots: settings.screenshots.map(id => id ? id.toString() : null)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/assets/:id', async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Image not found.' });
      const id = new ObjectId(req.params.id);
      const file = await db.collection('site_assets.files').findOne({ _id: id });
      if (!file) return res.status(404).json({ error: 'Image not found.' });
      res.set({
        'Content-Type': file.metadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      });
      bucket.openDownloadStream(id).on('error', next).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }), (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' ||
        !safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ token: createToken(adminUsername, sessionSecret) });
  });

  app.get('/api/admin/config', requireAdmin, async (req, res, next) => {
    try {
      const settings = await readSettings();
      res.set('Cache-Control', 'no-store');
      res.json({
        groupLink: settings.groupLink,
        logoId: settings.logoId ? settings.logoId.toString() : null,
        screenshots: settings.screenshots.map(id => id ? id.toString() : null)
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/admin/config', requireAdmin, (req, res, next) => {
    upload(req, res, async error => {
      if (error) {
        const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: error.message });
      }
      const uploadedIds = [];
      let settingsSaved = false;
      try {
        const groupLink = parseGroupLink(req.body.groupLink);
        const previous = await readSettings();
        const nextSettings = {
          _id: 'site',
          groupLink,
          logoId: previous.logoId || null,
          screenshots: [...previous.screenshots]
        };
        const fields = [
          ['logo', 'logoId'],
          ['screen1', 0],
          ['screen2', 1],
          ['screen3', 2]
        ];
        for (const [field, target] of fields) {
          const file = req.files?.[field]?.[0];
          if (!file) continue;
          const id = await storeImage(file);
          uploadedIds.push(id);
          if (target === 'logoId') nextSettings.logoId = id;
          else nextSettings.screenshots[target] = id;
        }
        await settingsCollection.replaceOne({ _id: 'site' }, nextSettings, { upsert: true });
        settingsSaved = true;
        const replaced = [];
        if (previous.logoId && previous.logoId.toString() !== nextSettings.logoId?.toString()) replaced.push(previous.logoId);
        previous.screenshots.forEach((id, index) => {
          if (id && id.toString() !== nextSettings.screenshots[index]?.toString()) replaced.push(id);
        });
        try {
          await removeImages(replaced);
        } catch (cleanupError) {
          console.error('[ADMIN] Settings saved, but replaced images could not be removed:', cleanupError);
        }
        res.json({
          groupLink: nextSettings.groupLink,
          logoId: nextSettings.logoId ? nextSettings.logoId.toString() : null,
          screenshots: nextSettings.screenshots.map(id => id ? id.toString() : null)
        });
      } catch (saveError) {
        if (!settingsSaved) {
          try {
            await removeImages(uploadedIds);
          } catch (cleanupError) {
            console.error('[ADMIN] Failed to clean up an incomplete image upload:', cleanupError);
          }
        }
        if (saveError.message === 'Enter a valid HTTPS group link.' ||
            saveError.message === 'The group link must start with https://.' ||
            saveError.message.startsWith('"')) {
          return res.status(400).json({ error: saveError.message });
        }
        next(saveError);
      }
    });
  });

  app.use((error, req, res, next) => {
    console.error('[API] Request failed:', error);
    if (res.headersSent) return next(error);
    if (error.message === 'Origin is not allowed.') return res.status(403).json({ error: error.message });
    res.status(500).json({ error: 'Server error. Please try again later.' });
  });

  return app;
}

async function start() {
  const mongoUri = requiredEnv('MONGODB_URI');
  const adminUsername = requiredEnv('ADMIN_USERNAME');
  const adminPassword = requiredEnv('ADMIN_PASSWORD');
  const sessionSecret = requiredEnv('SESSION_SECRET');
  const configuredOrigin = (process.env.ALLOWED_ORIGIN ||
    (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:5500' : '')).replace(/\/$/, '');
  if (!configuredOrigin) throw new Error('Missing required environment variable: ALLOWED_ORIGIN');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  let parsedOrigin;
  try {
    parsedOrigin = new URL(configuredOrigin);
  } catch {
    throw new Error('ALLOWED_ORIGIN must be a valid HTTPS origin.');
  }
  const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production' &&
    parsedOrigin.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
  if ((!isLocalDevelopmentOrigin && parsedOrigin.protocol !== 'https:') ||
      parsedOrigin.origin !== configuredOrigin ||
      parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error('ALLOWED_ORIGIN must be an HTTPS origin without a path (HTTP is allowed for localhost development only).');
  }
  const allowedOrigin = parsedOrigin.origin;

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();
  const bucket = new GridFSBucket(db, { bucketName: 'site_assets' });
  const app = createApp({ db, bucket, allowedOrigin, adminUsername, adminPassword, sessionSecret });
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => console.log(`[API] Listening on port ${port}`));

  const shutdown = async () => {
    server.close();
    await client.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch(error => {
    console.error('[API] Startup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { createApp, createToken, isValidImage, parseGroupLink, safeEqual, verifyToken };
