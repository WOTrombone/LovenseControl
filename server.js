import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

loadDotEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const port = Number(process.env.PORT || 3000);
const lovenseApiBase = process.env.LOVENSE_API_BASE || 'https://api.lovense-api.com';
const lovenseDeveloperToken = process.env.LOVENSE_DEVELOPER_TOKEN;
const lovensePlatform = process.env.LOVENSE_PLATFORM || 'LovenseControl';
const callbackEvents = [];
const lovenseRequestTimeoutMs = 10000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'LovenseControl',
        version: '0.5.0',
        hasLovenseToken: Boolean(lovenseDeveloperToken),
        platform: lovensePlatform
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/lovense/token') {
      return handleLovenseToken(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/lovense/callback') {
      return handleLovenseCallback(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/lovense/callback-events') {
      return sendJson(res, 200, { events: callbackEvents });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(url.pathname, res, req.method === 'HEAD');
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, () => {
  console.log(`LovenseControl listening on port ${port}`);
});

async function handleLovenseToken(req, res) {
  if (!lovenseDeveloperToken) {
    return sendJson(res, 500, {
      error: 'LOVENSE_DEVELOPER_TOKEN is not configured on the server.'
    });
  }

  const body = await readJsonBody(req);
  const uid = cleanId(body?.uid) || `host-${crypto.randomUUID()}`;
  const uname = cleanName(body?.uname) || 'Host';

  try {
    const lovenseResponse = await fetchWithTimeout(`${lovenseApiBase}/api/basicApi/getToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: lovenseDeveloperToken,
        uid,
        uname
      })
    }, lovenseRequestTimeoutMs);

    const data = await lovenseResponse.json().catch(() => null);

    if (!lovenseResponse.ok || data?.code !== 0) {
      return sendJson(res, 502, {
        error: 'Lovense token request failed.',
        status: lovenseResponse.status,
        lovense: data
      });
    }

    return sendJson(res, 200, {
      uid,
      uname,
      platform: lovensePlatform,
      authToken: data.data?.authToken
    });
  } catch (error) {
    return sendJson(res, error?.name === 'AbortError' ? 504 : 502, {
      error: 'Unable to reach Lovense token API.',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleLovenseCallback(req, res) {
  const body = await readJsonBody(req);
  const event = {
    receivedAt: new Date().toISOString(),
    uid: cleanId(body?.uid),
    appType: body?.appType,
    platform: body?.platform,
    domain: body?.domain,
    httpsPort: body?.httpsPort,
    toys: summarizeToys(body?.toys)
  };

  callbackEvents.unshift(event);
  callbackEvents.length = Math.min(callbackEvents.length, 10);

  console.log('Lovense callback received:', JSON.stringify(event));
  return sendJson(res, 200, { ok: true });
}

async function serveStatic(requestPath, res, headOnly) {
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const relativePath = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.join(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  try {
    const data = await fs.readFile(filePath);
    const headers = securityHeaders(contentType(filePath));
    res.writeHead(200, headers);
    if (!headOnly) res.end(data);
    else res.end();
  } catch {
    sendJson(res, 404, { error: 'Not found', path: requestPath });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, securityHeaders('application/json'));
  res.end(body);
}

function securityHeaders(type) {
  return {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://api.lovense-api.com",
      "connect-src 'self' https://api.lovense-api.com https://*.lovense-api.com https://*.lovense.club:* wss://*.lovense-api.com wss://*.lovense.club:*",
      "img-src 'self' data: https://*.lovense.com https://*.lovense-api.com",
      "style-src 'self' 'unsafe-inline'"
    ].join('; ')
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function cleanId(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 64);
}

function summarizeToys(toys) {
  if (!toys || typeof toys !== 'object') return [];

  return Object.values(toys).map((toy) => ({
    id: cleanId(toy?.id),
    name: cleanName(toy?.name),
    nickName: cleanName(toy?.nickName),
    status: toy?.status
  }));
}

function loadDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const text = fsSyncRead(envPath);

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // A .env file is optional. Render should use environment variables.
  }
}

function fsSyncRead(filePath) {
  return fsSync.readFileSync(filePath, 'utf8');
}
