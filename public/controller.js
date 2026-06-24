const params = new URLSearchParams(window.location.search);
const roomId = cleanId(params.get('room')) || '';
const defaultName = cleanName(params.get('name')) || 'Controller';

const title = document.querySelector('#controller-title');
const hostName = document.querySelector('#host-name');
const roomLabel = document.querySelector('#room-label');
const statusText = document.querySelector('#controller-status');
const note = document.querySelector('#controller-note');
const assignedToy = document.querySelector('#assigned-toy');
const assignedToyNote = document.querySelector('#assigned-toy-note');
const joinPanel = document.querySelector('.join-panel');
const nameInput = document.querySelector('#controller-name');
const requestButton = document.querySelector('#request-access');
const intensity = document.querySelector('#intensity');
const intensityOutput = document.querySelector('#intensity-output');
const releaseStop = document.querySelector('#release-stop');
const liveMode = document.querySelector('#live-mode');
const pulseMode = document.querySelector('#pulse-mode');
const chaosMode = document.querySelector('#chaos-mode');

let controllerId = '';
let pollTimer;
let roomSocket;
let sendTimer;
let pendingLevel = null;
let levelSendInFlight = false;
let lastLevelSentAt = 0;
let approved = false;
let revoked = false;
let controlsEnabled = false;
let controlMode = 'level';
const liveSendIntervalMs = 120;

nameInput.value = defaultName;
title.textContent = defaultName;
roomLabel.textContent = roomId ? `Room ${roomId} · waiting for host approval.` : 'Missing room invite.';
requestButton.disabled = !roomId;

nameInput.addEventListener('input', () => {
  title.textContent = cleanName(nameInput.value) || 'Controller';
});
requestButton.addEventListener('click', requestAccess);
intensity.addEventListener('input', () => {
  renderIntensity();
  scheduleLiveLevel();
});
releaseStop.addEventListener('click', stopSending);
liveMode.addEventListener('click', useLiveMode);
pulseMode.addEventListener('click', usePulseMode);
chaosMode.addEventListener('click', useChaosMode);

renderState();

async function requestAccess() {
  requestButton.disabled = true;
  requestButton.textContent = 'Requesting...';

  try {
    const response = await fetchWithTimeout(`/api/rooms/${roomId}/controllers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cleanName(nameInput.value) || 'Controller'
      })
    }, 10000);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Access request failed.');

    controllerId = data.id;
    joinPanel.hidden = true;
    renderController(data);
    startPolling();
  } catch (error) {
    statusText.textContent = 'Request failed';
    note.textContent = errorToText(error);
    joinPanel.hidden = false;
    requestButton.disabled = false;
    requestButton.textContent = 'Request Control';
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (roomSocket) roomSocket.close();
  openRoomSocket();
  pollTimer = setInterval(loadController, 5000);
  loadController();
}

function openRoomSocket() {
  if (!roomId || !controllerId || !window.WebSocket) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${roomId}/socket`);
  roomSocket = socket;

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type !== 'room') return;
      renderHostName(message.room?.hostName);
      const controller = (message.room?.controllers || []).find((candidate) => candidate.id === controllerId);
      if (controller) renderController(controller);
    } catch (error) {
      statusText.textContent = 'Live update failed';
      note.textContent = errorToText(error);
    }
  });

  socket.addEventListener('close', () => {
    if (roomSocket === socket) roomSocket = undefined;
  });
}

async function loadController() {
  if (!roomId || !controllerId) return;

  try {
    const data = await getJson(`/api/rooms/${roomId}/controllers/${controllerId}`);
    renderController(data);
  } catch (error) {
    statusText.textContent = 'Disconnected';
    note.textContent = errorToText(error);
    setControlEnabled(false);
  }
}

function renderController(controller) {
  renderHostName(controller.hostName);
  approved = Boolean(controller.approved);
  revoked = Boolean(controller.revoked);
  const toyName = cleanName(controller.assignedToyName) || cleanId(controller.assignedToyId);
  const hasAssignedToy = Boolean(controller.assignedToyId);
  const intentActive = Boolean(controller.intent?.active);

  if (!intentActive && clampIntensity(intensity.value) !== 0) {
    intensity.value = '0';
    pendingLevel = null;
    renderIntensity();
  }

  assignedToy.textContent = toyName || 'Not assigned yet';
  assignedToyNote.textContent = hasAssignedToy
    ? 'Requests from this page go only to this assigned toy.'
    : 'The host has not assigned a toy to this controller yet.';

  if (revoked) {
    statusText.textContent = 'Revoked';
    statusText.className = 'status-pill warn';
    roomLabel.textContent = 'Revoked';
    note.textContent = 'The host has revoked this controller.';
    joinPanel.hidden = true;
    setControlEnabled(false);
    return;
  }

  if (approved) {
    statusText.textContent = 'Approved';
    statusText.className = hasAssignedToy ? 'status-pill good' : 'status-pill warn';
    roomLabel.textContent = hasAssignedToy ? 'Controlling' : 'Waiting';
    note.textContent = hasAssignedToy
      ? 'Move the slider for a steady level, or use Pulse for an alternating pattern.'
      : 'Waiting for the host to assign a toy.';
    joinPanel.hidden = true;
    setControlEnabled(hasAssignedToy);
    return;
  }

  statusText.textContent = 'Pending host approval';
  statusText.className = 'status-pill warn';
  roomLabel.textContent = 'Pending';
  note.textContent = 'The host can approve or revoke this request from their dashboard.';
  joinPanel.hidden = true;
  setControlEnabled(false);
}

function renderHostName(value) {
  hostName.textContent = cleanName(value) || 'Host';
}

function renderState() {
  if (!roomId) {
    statusText.textContent = 'Missing room';
    statusText.className = 'status-pill warn';
    roomLabel.textContent = 'Missing room';
    note.textContent = 'Open a controller invite link from the host dashboard.';
    joinPanel.hidden = false;
    assignedToy.textContent = 'Not assigned yet';
    assignedToyNote.textContent = 'The host chooses which toy this controller can affect.';
    setControlEnabled(false);
  }
}

function scheduleLiveLevel(immediate = false) {
  if (!controlsEnabled) return;
  controlMode = 'level';
  renderMode();
  pendingLevel = clampIntensity(intensity.value);

  if (immediate) {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = undefined;
    sendLatestLevel();
    return;
  }

  if (!sendTimer && !levelSendInFlight) {
    const elapsed = Date.now() - lastLevelSentAt;
    const delay = Math.max(0, liveSendIntervalMs - elapsed);
    sendTimer = setTimeout(sendLatestLevel, delay);
  }
}

async function sendCurrentLevel() {
  if (!controlsEnabled) return;
  controlMode = 'level';
  renderMode();
  pendingLevel = clampIntensity(intensity.value);
  await sendLatestLevel();
}

async function stopSending() {
  if (!approved && !controlsEnabled) return;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = undefined;
  pendingLevel = null;
  controlMode = 'level';
  intensity.value = '0';
  renderIntensity();
  renderMode();
  await sendIntent(false, {
    mode: 'level'
  });
}

async function useLiveMode() {
  if (!controlsEnabled) return;
  controlMode = 'level';
  renderMode();
  await sendCurrentLevel();
}

async function usePulseMode() {
  if (!controlsEnabled) return;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = undefined;
  pendingLevel = null;
  controlMode = 'pattern';
  renderMode();
  await sendIntent(true, {
    mode: 'pattern',
    pattern: {
      strength: '20;0;20;0',
      interval: 250
    }
  });
}

async function useChaosMode() {
  if (!controlsEnabled) return;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = undefined;
  pendingLevel = null;
  controlMode = 'chaos';
  renderMode();
  await sendIntent(true, {
    mode: 'pattern',
    pattern: {
      strength: '20;0;16;20;4;0;20;9;18;0;13;20;0;7;20;3',
      interval: 140
    }
  });
}

async function sendIntent(active, options = {}) {
  if (!roomId || !controllerId) return;

  try {
    await fetchWithTimeout(`/api/rooms/${roomId}/controllers/${controllerId}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active,
        mode: options.mode || controlMode,
        intensity: active ? clampIntensity(options.intensity ?? intensity.value) : 0,
        pattern: options.pattern || null
      })
    }, 10000);
  } catch (error) {
    statusText.textContent = 'Send failed';
    note.textContent = errorToText(error);
  }
}

async function sendLatestLevel() {
  if (sendTimer) {
    clearTimeout(sendTimer);
    sendTimer = undefined;
  }
  if (!controlsEnabled || !roomId || !controllerId || pendingLevel === null || levelSendInFlight) return;

  const level = pendingLevel;
  pendingLevel = null;
  levelSendInFlight = true;
  lastLevelSentAt = Date.now();
  try {
    await sendIntent(level > 0, {
      mode: 'level',
      intensity: level
    }, 10000);
  } catch (error) {
    statusText.textContent = 'Send failed';
    note.textContent = errorToText(error);
  } finally {
    levelSendInFlight = false;
    if (pendingLevel !== null && controlsEnabled) {
      scheduleLiveLevel();
    }
  }
}

function setControlEnabled(enabled) {
  controlsEnabled = enabled;
  if (!enabled && sendTimer) {
    clearTimeout(sendTimer);
    sendTimer = undefined;
  }
  if (!enabled) pendingLevel = null;
  intensity.disabled = !enabled;
  releaseStop.disabled = !enabled;
  liveMode.disabled = !enabled;
  pulseMode.disabled = !enabled;
  chaosMode.disabled = !enabled;
  renderMode();
}

function renderIntensity() {
  intensityOutput.textContent = `${intensity.value} / 20`;
}

function renderMode() {
  liveMode.classList.toggle('active', controlMode === 'level');
  pulseMode.classList.toggle('active', controlMode === 'pattern');
  chaosMode.classList.toggle('active', controlMode === 'chaos');
}

async function getJson(url) {
  const response = await fetchWithTimeout(url, {}, 10000);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function clampIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(20, Math.round(number)));
}

function errorToText(error) {
  return error instanceof Error ? error.message : String(error);
}
