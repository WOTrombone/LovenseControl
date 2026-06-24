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
const rooms = new Map();
const roomSocketClients = new Map();
let socketIoClientPromise;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'LovenseControl',
        version: '0.18.4',
        hasLovenseToken: Boolean(lovenseDeveloperToken),
        platform: lovensePlatform,
        backendSocketRouting: true
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      return handleCreateRoom(req, res);
    }

    if (url.pathname.startsWith('/api/rooms/')) {
      return handleRoomRoute(req, res, url);
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

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'rooms' || parts[3] !== 'socket') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const roomId = cleanId(parts[2]);
    const room = rooms.get(roomId);
    const key = req.headers['sec-websocket-key'];

    if (!room || typeof key !== 'string') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ].join('\r\n'));

    addRoomSocketClient(room.id, socket);
    sendRoomSocketMessage(socket, room);

    const keepAlive = setInterval(() => {
      sendWebSocketFrame(socket, 0x9, '');
    }, 25000);

    const cleanup = () => {
      clearInterval(keepAlive);
      removeRoomSocketClient(room.id, socket);
    };

    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);
  } catch {
    socket.destroy();
  }
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
    const data = await requestLovenseToken(uid, uname);
    return sendJson(res, 200, {
      uid,
      uname,
      platform: lovensePlatform,
      authToken: data.authToken
    });
  } catch (error) {
    return sendJson(res, error?.name === 'AbortError' ? 504 : 502, {
      error: 'Unable to reach Lovense token API.',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleCreateRoom(req, res) {
  const body = await readJsonBody(req);
  const roomId = crypto.randomUUID().slice(0, 8);
  const room = {
    id: roomId,
    hostName: cleanName(body?.hostName) || 'Host',
    createdAt: new Date().toISOString(),
    controllers: new Map(),
    commandState: new Map(),
    safety: {
      routingEnabled: false,
      intensityCap: 5
    },
    lovense: {
      uid: '',
      uname: '',
      socketStatus: 'not connected',
      socketError: '',
      qrcode: null,
      deviceInfo: null,
      appConnected: false,
      appOnline: false,
      toys: []
    }
  };

  rooms.set(roomId, room);
  broadcastRoom(room);
  return sendJson(res, 201, serializeRoom(room));
}

async function handleRoomRoute(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const roomId = cleanId(parts[2]);
  const room = rooms.get(roomId);

  if (!room) {
    return sendJson(res, 404, { error: 'Room not found.' });
  }

  if (req.method === 'GET' && parts.length === 3) {
    return sendJson(res, 200, serializeRoom(room));
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'stop') {
    stopRoomControllerIntents(room);
    sendHardStopFromRoom(room, 'room-stop');
    broadcastRoom(room);
    return sendJson(res, 200, serializeRoom(room));
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'safety') {
    const body = await readJsonBody(req);
    const wasEnabled = room.safety.routingEnabled;
    room.safety.routingEnabled = Boolean(body?.routingEnabled);
    room.safety.intensityCap = clampIntensity(body?.intensityCap ?? room.safety.intensityCap);

    if (wasEnabled && !room.safety.routingEnabled) {
      stopRoomControllerIntents(room);
      sendHardStopFromRoom(room, 'routing-disabled');
    } else {
      routeRoomControllerIntents(room);
    }

    broadcastRoom(room);
    return sendJson(res, 200, serializeRoom(room));
  }

  if (parts[3] === 'lovense') {
    if (req.method === 'POST' && parts.length === 5 && parts[4] === 'session') {
      return handleRoomLovenseSession(req, res, room);
    }

    if (req.method === 'POST' && parts.length === 5 && parts[4] === 'command') {
      const body = await readJsonBody(req);
      const toyId = cleanId(body?.toyId);
      const action = cleanLovenseAction(body?.action) || 'Vibrate:1';
      const timeSec = clampCommandTime(body?.timeSec, 2);
      const command = buildLovenseFunctionCommand(action, toyId, timeSec);
      const result = sendRoomLovenseCommand(room, command, 'manual-command');

      if (!result.ok) {
        return sendJson(res, 409, result);
      }

      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'Not found', path: url.pathname });
  }

  if (parts[3] !== 'controllers') {
    return sendJson(res, 404, { error: 'Not found', path: url.pathname });
  }

  if (req.method === 'POST' && parts.length === 4) {
    const body = await readJsonBody(req);
    const controllerId = crypto.randomUUID().slice(0, 8);
    const controller = {
      id: controllerId,
      name: cleanName(body?.name) || 'Controller',
      assignedToyId: '',
      assignedToyName: '',
      approved: false,
      revoked: false,
      connected: true,
      nextGestureId: 1,
      gestureEvents: [],
      intent: {
        active: false,
        mode: 'level',
        intensity: 0,
        pattern: null,
        updatedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    room.controllers.set(controllerId, controller);
    broadcastRoom(room);
    return sendJson(res, 201, serializeController(controller));
  }

  const controllerId = cleanId(parts[4]);
  const controller = room.controllers.get(controllerId);

  if (!controller) {
    return sendJson(res, 404, { error: 'Controller not found.' });
  }

  if (req.method === 'GET' && parts.length === 5) {
    return sendJson(res, 200, serializeController(controller));
  }

  if (req.method === 'POST' && parts[5] === 'intent') {
    const body = await readJsonBody(req);
    const intensity = clampIntensity(body?.intensity);
    const mode = body?.mode === 'pattern' ? 'pattern' : 'level';
    const pattern = mode === 'pattern' ? cleanPattern(body?.pattern) : null;
    const active = Boolean(body?.active) && (mode === 'pattern' ? Boolean(pattern) : intensity > 0);

    controller.intent = {
      active,
      mode,
      intensity: active ? intensity : 0,
      pattern: active ? pattern : null,
      updatedAt: new Date().toISOString()
    };
    controller.gestureEvents = [];
    controller.connected = true;
    controller.updatedAt = new Date().toISOString();

    routeRoomControllerIntents(room);
    broadcastRoom(room);
    return sendJson(res, 200, serializeController(controller));
  }

  if (req.method === 'POST' && parts[5] === 'gesture') {
    const body = await readJsonBody(req);
    const rawSamples = Array.isArray(body?.samples) ? body.samples : [];
    const now = new Date().toISOString();
    const latestRawSample = rawSamples[rawSamples.length - 1];

    if (!latestRawSample) {
      return sendJson(res, 400, { error: 'No gesture samples supplied.' });
    }

    const latest = {
      id: controller.nextGestureId++,
      intensity: clampIntensity(latestRawSample?.intensity),
      sentAt: cleanTimestamp(latestRawSample?.sentAt) || now
    };
    controller.gestureEvents = [];
    controller.intent = {
      active: latest.intensity > 0,
      mode: 'level',
      intensity: latest.intensity,
      pattern: null,
      updatedAt: now
    };
    controller.connected = true;
    controller.updatedAt = now;

    routeRoomControllerIntents(room);
    broadcastRoom(room);
    return sendJson(res, 200, {
      ok: true,
      accepted: rawSamples.length,
      collapsedToLatest: true,
      latest,
      controller: serializeController(controller)
    });
  }

  if (req.method === 'POST' && parts[5] === 'approval') {
    const body = await readJsonBody(req);
    controller.approved = Boolean(body?.approved);
    controller.revoked = !controller.approved && Boolean(body?.revoked);
    if (!controller.approved) {
      controller.intent = {
        active: false,
        mode: 'level',
        intensity: 0,
        pattern: null,
        updatedAt: new Date().toISOString()
      };
      controller.gestureEvents = [];
    }
    controller.updatedAt = new Date().toISOString();

    routeRoomControllerIntents(room);
    broadcastRoom(room);
    return sendJson(res, 200, serializeController(controller));
  }

  if (req.method === 'POST' && parts[5] === 'assignment') {
    const body = await readJsonBody(req);
    controller.assignedToyId = cleanId(body?.assignedToyId);
    controller.assignedToyName = controller.assignedToyId ? cleanName(body?.assignedToyName) : '';
    controller.updatedAt = new Date().toISOString();

    routeRoomControllerIntents(room);
    broadcastRoom(room);
    return sendJson(res, 200, serializeController(controller));
  }

  return sendJson(res, 404, { error: 'Not found', path: url.pathname });
}

async function requestLovenseToken(uid, uname) {
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

  if (!lovenseResponse.ok || data?.code !== 0 || !data?.data?.authToken) {
    const error = new Error('Lovense token request failed.');
    error.status = lovenseResponse.status;
    error.lovense = data;
    throw error;
  }

  return {
    uid,
    uname,
    authToken: data.data.authToken
  };
}

async function requestLovenseSocketInfo(authToken) {
  const lovenseResponse = await fetchWithTimeout(`${lovenseApiBase}/api/basicApi/getSocketUrl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: lovensePlatform,
      authToken
    })
  }, lovenseRequestTimeoutMs);

  const data = await lovenseResponse.json().catch(() => null);

  if (!lovenseResponse.ok || data?.code !== 0 || !data?.data?.socketIoUrl || !data?.data?.socketIoPath) {
    const error = new Error('Lovense socket URL request failed.');
    error.status = lovenseResponse.status;
    error.lovense = data;
    throw error;
  }

  return data.data;
}

async function handleRoomLovenseSession(req, res, room) {
  if (!lovenseDeveloperToken) {
    return sendJson(res, 500, {
      error: 'LOVENSE_DEVELOPER_TOKEN is not configured on the server.'
    });
  }

  const body = await readJsonBody(req);
  const uid = cleanId(body?.uid) || `host-${room.id}`;
  const uname = cleanName(body?.uname) || room.hostName || 'Host';

  try {
    const token = await requestLovenseToken(uid, uname);
    const socketInfo = await requestLovenseSocketInfo(token.authToken);
    await connectRoomLovenseSocket(room, {
      uid,
      uname,
      authToken: token.authToken,
      socketIoPath: socketInfo.socketIoPath,
      socketIoUrl: socketInfo.socketIoUrl
    });

    return sendJson(res, 200, serializeRoom(room));
  } catch (error) {
    room.lovense.socketStatus = 'error';
    room.lovense.socketError = error instanceof Error ? error.message : String(error);
    broadcastRoom(room);

    return sendJson(res, error?.name === 'AbortError' ? 504 : 502, {
      error: room.lovense.socketError,
      status: error?.status,
      lovense: error?.lovense
    });
  }
}

async function connectRoomLovenseSocket(room, session) {
  const io = await loadSocketIoClient();

  if (room.lovense.socket?.disconnect) {
    room.lovense.socket.disconnect();
  } else if (room.lovense.socket?.close) {
    room.lovense.socket.close();
  }

  room.lovense = {
    ...room.lovense,
    uid: session.uid,
    uname: session.uname,
    authToken: session.authToken,
    socketStatus: 'connecting',
    socketError: '',
    qrcode: null,
    deviceInfo: null,
    appConnected: false,
    appOnline: false,
    toys: []
  };
  broadcastRoom(room);

  const socket = io(session.socketIoUrl, {
    path: session.socketIoPath,
    transports: ['websocket'],
    forceNew: true,
    reconnection: true
  });

  room.lovense.socket = socket;

  socket.on('connect', () => {
    room.lovense.socketStatus = 'connected';
    room.lovense.socketError = '';
    socket.emit('basicapi_get_qrcode_ts', {
      ackId: `qr-${room.id}-${Date.now()}`
    });
    broadcastRoom(room);
  });

  socket.on('disconnect', (reason) => {
    room.lovense.socketStatus = 'disconnected';
    room.lovense.socketError = String(reason || '');
    broadcastRoom(room);
  });

  socket.on('connect_error', (error) => {
    room.lovense.socketStatus = 'error';
    room.lovense.socketError = errorToText(error);
    broadcastRoom(room);
  });

  socket.on('connect_timeout', () => {
    room.lovense.socketStatus = 'error';
    room.lovense.socketError = 'Timed out connecting to Lovense socket.';
    broadcastRoom(room);
  });

  socket.on('reconnect_attempt', () => {
    room.lovense.socketStatus = 'reconnecting';
    broadcastRoom(room);
  });

  socket.on('reconnect_error', (error) => {
    room.lovense.socketStatus = 'error';
    room.lovense.socketError = errorToText(error);
    broadcastRoom(room);
  });

  socket.on('basicapi_get_qrcode_tc', (payload) => {
    const data = parseLovenseSocketPayload(payload);
    room.lovense.qrcode = data?.data || data || null;
    broadcastRoom(room);
  });

  socket.on('basicapi_update_device_info_tc', (payload) => {
    const data = parseLovenseSocketPayload(payload);
    room.lovense.deviceInfo = data?.data || data || null;
    room.lovense.appConnected = Boolean(room.lovense.deviceInfo?.online ?? true);
    room.lovense.toys = normalizeLovenseToys(room.lovense.deviceInfo?.toyList || room.lovense.deviceInfo?.toys);
    broadcastRoom(room);
    routeRoomControllerIntents(room);
  });

  socket.on('basicapi_update_app_status_tc', (payload) => {
    const data = parseLovenseSocketPayload(payload);
    room.lovense.appConnected = Boolean(data?.data ?? data);
    broadcastRoom(room);
  });

  socket.on('basicapi_update_app_online_tc', (payload) => {
    const data = parseLovenseSocketPayload(payload);
    room.lovense.appOnline = Boolean(data?.data ?? data);
    broadcastRoom(room);
  });
}

async function loadSocketIoClient() {
  if (!socketIoClientPromise) {
    socketIoClientPromise = import('socket.io-client').then((module) => module.default || module);
  }

  return socketIoClientPromise;
}

function routeRoomControllerIntents(room) {
  if (!room.lovense?.socket || room.lovense.socketStatus !== 'connected') return;
  if (!room.safety?.routingEnabled) return;

  const onlineToyIds = new Set((room.lovense.toys || [])
    .filter((toy) => toy.connected)
    .map((toy) => toy.id)
    .filter(Boolean));
  const activeToyIds = new Set();

  for (const controller of room.controllers.values()) {
    if (!controller.approved
      || controller.revoked
      || !controller.assignedToyId
      || !onlineToyIds.has(controller.assignedToyId)
      || !controller.intent?.active) {
      continue;
    }

    if (activeToyIds.has(controller.assignedToyId)) continue;
    activeToyIds.add(controller.assignedToyId);

    if (controller.intent.mode === 'pattern' && controller.intent.pattern) {
      const pattern = capPattern(controller.intent.pattern, clampIntensity(room.safety.intensityCap));
      const key = `pattern:${controller.id}:${pattern.strength}:${pattern.interval}`;
      if (room.commandState.get(controller.assignedToyId)?.key === key) continue;

      const command = {
        command: 'Pattern',
        rule: 'V:1;F:v;S:' + pattern.strength,
        strength: pattern.strength,
        timeSec: 0,
        toy: controller.assignedToyId,
        apiVer: 2
      };
      const result = sendRoomLovenseCommand(room, command, `pattern:${controller.name}`);
      if (result.ok) {
        room.commandState.set(controller.assignedToyId, {
          key,
          at: Date.now()
        });
      }
      continue;
    }

    const intensity = Math.min(clampIntensity(room.safety.intensityCap), clampIntensity(controller.intent.intensity));
    const key = `level:${controller.id}:${intensity}`;
    if (room.commandState.get(controller.assignedToyId)?.key === key) continue;

    const result = sendRoomLovenseCommand(room, buildLovenseFunctionCommand(`Vibrate:${intensity}`, controller.assignedToyId, 0), `level:${controller.name}`);
    if (result.ok) {
      room.commandState.set(controller.assignedToyId, {
        key,
        at: Date.now()
      });
    }
  }

  for (const [toyId] of room.commandState) {
    if (!activeToyIds.has(toyId)) {
      sendRoomLovenseCommand(room, buildLovenseFunctionCommand('Stop', toyId, 0), 'auto-stop-inactive-toy');
      room.commandState.delete(toyId);
    }
  }
}

function capPattern(pattern, cap) {
  return {
    strength: String(pattern.strength || '')
      .split(';')
      .map((value) => Math.min(cap, clampIntensity(value)))
      .join(';'),
    interval: pattern.interval
  };
}

function stopRoomControllerIntents(room) {
  const stoppedAt = new Date().toISOString();

  for (const controller of room.controllers.values()) {
    controller.intent = {
      active: false,
      mode: 'level',
      intensity: 0,
      pattern: null,
      updatedAt: stoppedAt
    };
    controller.gestureEvents = [];
    controller.updatedAt = stoppedAt;
  }

  room.commandState.clear();
}

function sendHardStopFromRoom(room, reason) {
  const toyIds = (room.lovense?.toys || []).map((toy) => toy.id).filter(Boolean);
  const targets = ['', ...toyIds];

  for (const toyId of targets) {
    sendRoomLovenseCommand(room, buildLovenseFunctionCommand('Stop', toyId, 0), reason);
    sendRoomLovenseCommand(room, buildLovenseFunctionCommand('Vibrate:0', toyId, 0), reason);
  }
}

function sendRoomLovenseCommand(room, command, reason) {
  if (!room.lovense?.socket || room.lovense.socketStatus !== 'connected') {
    return {
      ok: false,
      error: 'Lovense backend socket is not connected.'
    };
  }

  try {
    room.lovense.socket.emit('basicapi_send_toy_command_ts', command);
    room.lovense.lastCommand = {
      reason,
      command,
      sentAt: new Date().toISOString()
    };
    broadcastRoom(room);
    return {
      ok: true,
      path: 'backend-socket',
      reason,
      command
    };
  } catch (error) {
    return {
      ok: false,
      error: errorToText(error)
    };
  }
}

function buildLovenseFunctionCommand(action, toyId = '', timeSec = 0) {
  const command = {
    command: 'Function',
    action,
    timeSec,
    stopPrevious: 1,
    apiVer: 1
  };

  if (toyId) command.toy = toyId;
  return command;
}

function parseLovenseSocketPayload(payload) {
  if (typeof payload !== 'string') return payload;

  try {
    return JSON.parse(payload);
  } catch {
    return payload;
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

function addRoomSocketClient(roomId, socket) {
  const clients = roomSocketClients.get(roomId) || new Set();
  clients.add(socket);
  roomSocketClients.set(roomId, clients);
}

function removeRoomSocketClient(roomId, socket) {
  const clients = roomSocketClients.get(roomId);
  if (!clients) return;
  clients.delete(socket);
  if (clients.size === 0) roomSocketClients.delete(roomId);
}

function broadcastRoom(room) {
  const clients = roomSocketClients.get(room.id);
  if (!clients) return;

  for (const client of clients) {
    sendRoomSocketMessage(client, room);
  }
}

function sendRoomSocketMessage(socket, room) {
  sendWebSocketFrame(socket, 0x1, JSON.stringify({
    type: 'room',
    room: serializeRoom(room)
  }));
}

function sendWebSocketFrame(socket, opcode, payload) {
  if (socket.destroyed) return;

  const body = Buffer.from(String(payload));
  let header;

  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  socket.write(Buffer.concat([header, body]));
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
      "connect-src 'self' ws: wss: https://api.lovense-api.com https://*.lovense-api.com https://*.lovense.club:* wss://*.lovense-api.com wss://*.lovense.club:*",
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

function cleanTimestamp(value) {
  if (typeof value !== 'string') return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function clampIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(20, Math.round(number)));
}

function cleanPattern(value) {
  if (!value || typeof value !== 'object') return null;

  const strengths = String(value.strength || '')
    .split(';')
    .map(clampIntensity)
    .slice(0, 50);

  if (strengths.length === 0 || strengths.every((strength) => strength === 0)) return null;

  const interval = Number(value.interval);
  const safeInterval = Number.isFinite(interval)
    ? Math.max(120, Math.min(2000, Math.round(interval)))
    : 250;

  return {
    strength: strengths.join(';'),
    interval: safeInterval
  };
}

function cleanLovenseAction(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/[^a-zA-Z0-9:,_-]/g, '').slice(0, 256);
  if (!cleaned) return '';
  if (cleaned === 'Stop') return cleaned;
  if (/^(Vibrate|Rotate|Pump|Thrusting|Fingering|Suction|Depth|Stroke|Oscillate|All):([0-9]|1[0-9]|20)(,(Vibrate|Rotate|Pump|Thrusting|Fingering|Suction|Depth|Stroke|Oscillate|All):([0-9]|1[0-9]|20))*$/.test(cleaned)) {
    return cleaned;
  }
  return '';
}

function clampCommandTime(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(3600, Math.round(number)));
}

function normalizeLovenseToys(value) {
  if (!value) return [];
  const toys = Array.isArray(value) ? value : Object.values(value);

  return toys.map((toy) => ({
    id: cleanId(toy?.id),
    name: cleanName(toy?.name),
    toyType: cleanName(toy?.toyType),
    nickname: cleanName(toy?.nickname || toy?.nickName),
    fVersion: toy?.fVersion ?? '',
    hVersion: toy?.hVersion ?? '',
    battery: Number.isFinite(Number(toy?.battery)) ? Number(toy.battery) : null,
    connected: Boolean(toy?.connected || toy?.status === '1' || toy?.status === 1)
  })).filter((toy) => toy.id || toy.name || toy.toyType);
}

function serializeRoom(room) {
  return {
    id: room.id,
    hostName: room.hostName,
    createdAt: room.createdAt,
    safety: {
      routingEnabled: Boolean(room.safety?.routingEnabled),
      intensityCap: clampIntensity(room.safety?.intensityCap ?? 5)
    },
    lovense: serializeRoomLovense(room.lovense),
    controllers: Array.from(room.controllers.values()).map(serializeController)
  };
}

function serializeRoomLovense(lovense = {}) {
  return {
    uid: lovense.uid || '',
    uname: lovense.uname || '',
    socketStatus: lovense.socketStatus || 'not connected',
    socketError: lovense.socketError || '',
    qrcode: lovense.qrcode || null,
    deviceInfo: lovense.deviceInfo ? {
      deviceCode: lovense.deviceInfo.deviceCode,
      online: lovense.deviceInfo.online,
      domain: lovense.deviceInfo.domain,
      httpsPort: lovense.deviceInfo.httpsPort,
      wssPort: lovense.deviceInfo.wssPort,
      appVersion: lovense.deviceInfo.appVersion,
      platform: lovense.deviceInfo.platform,
      appType: lovense.deviceInfo.appType
    } : null,
    appConnected: Boolean(lovense.appConnected),
    appOnline: Boolean(lovense.appOnline),
    toys: lovense.toys || [],
    lastCommand: lovense.lastCommand || null
  };
}

function serializeController(controller) {
  return {
    id: controller.id,
    name: controller.name,
    assignedToyId: controller.assignedToyId || '',
    assignedToyName: controller.assignedToyName || '',
    approved: controller.approved,
    revoked: controller.revoked,
    connected: controller.connected,
    intent: controller.intent,
    gestureEvents: controller.gestureEvents || [],
    createdAt: controller.createdAt,
    updatedAt: controller.updatedAt
  };
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

function errorToText(error) {
  return error instanceof Error ? error.message : String(error);
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
