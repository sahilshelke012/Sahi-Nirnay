import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { contactRoutes } from './routes/contactRoutes.js';

const frontend = fileURLToPath(new URL('../../edplus-html.vercel.app/', import.meta.url));
const pages = readdirSync(frontend, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
  .map(entry => entry.name);

// Keep the template's existing inline scripts without permitting arbitrary inline JavaScript.
const scriptHashes = new Set(pages.flatMap(name => {
  const html = readFileSync(join(frontend, name), 'utf8').replace(/\r\n?/g, '\n');
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter(match => match[1].trim())
    .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
}));

const liveServerOrigins = new Set(['http://127.0.0.1:5500', 'http://localhost:5500']);

function allowLocalPreview(method) {
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    if (!liveServerOrigins.has(origin)) return next();

    res.set('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', method);
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendStatus(204);
    }
    next();
  };
}

export function createApp({ Contact, isDatabaseReady, notifyEnquiry, logError = console.error, production = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    strictTransportSecurity: production,
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', ...scriptHashes],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
        frameSrc: ['https://www.youtube.com', 'https://www.google.com'],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
  }));

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  if (!production) {
    app.all('/api/health', allowLocalPreview('GET'));
    app.all('/api/contact', allowLocalPreview('POST'));
  }
  app.get('/api/health', (_req, res) => {
    const ok = isDatabaseReady();
    res.status(ok ? 200 : 503).json({ ok, status: ok ? 'ready' : 'unavailable' });
  });
  app.use('/api/contact', contactRoutes({ Contact, isDatabaseReady, notifyEnquiry, logError }));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, message: 'API endpoint not found.' }));

  app.use('/assets', express.static(join(frontend, 'assets'), { index: false, redirect: false }));
  app.get('/', (_req, res) => res.sendFile(join(frontend, 'index.html')));
  for (const page of pages) {
    app.get(`/${page}`, (_req, res) => res.sendFile(join(frontend, page)));
  }
  app.use((_req, res) => res.status(404).send('Page not found.'));

  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    const messages = {
      400: 'The request is malformed.',
      413: 'The request is too large.',
      415: 'The request encoding is not supported.',
      500: 'An unexpected error occurred.',
    };
    if (status === 500) logError('Unexpected request failure.');
    res.status(status).json({ ok: false, message: messages[status] });
  });
  return app;
}
