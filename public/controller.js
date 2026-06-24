const params = new URLSearchParams(window.location.search);
const roomId = cleanId(params.get('room')) || '';
const defaultName = cleanName(params.get('name')) || 'Controller';

const title = document.querySelector('#controller-title');
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

let controllerId = '';
let pollTimer;
let sendTimer;
let approved = false;
let revoked = false;
let controlsEnabled = false;

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
  scheduleSendCurrentLevel();
});
releaseStop.addEventListener('click', stopSending);

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
  pollTimer = setInterval(loadController, 1000);
  loadController();
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
  approved = Boolean(controller.approved);
  revoked = Boolean(controller.revoked);
  const toyName = cleanName(controller.assignedToyName) || cleanId(controller.assignedToyId);
  const hasAssignedToy = Boolean(controller.assignedToyId);

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
      ? 'Move the slider to send a level. Set it to 0 or press Stop to stop.'
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

function scheduleSendCurrentLevel() {
  if (!controlsEnabled) return;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = setTimeout(sendCurrentLevel, 150);
}

async function sendCurrentLevel() {
  if (!controlsEnabled) return;
  await sendIntent(Number(intensity.value || 0) > 0);
}

async function stopSending() {
  if (!approved && !controlsEnabled) return;
  if (sendTimer) clearTimeout(sendTimer);
  intensity.value = '0';
  renderIntensity();
  await sendIntent(false);
}

async function sendIntent(active) {
  if (!roomId || !controllerId) return;

  try {
    await fetchWithTimeout(`/api/rooms/${roomId}/controllers/${controllerId}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active,
        intensity: active ? Number(intensity.value || 0) : 0
      })
    }, 10000);
  } catch (error) {
    statusText.textContent = 'Send failed';
    note.textContent = errorToText(error);
  }
}

function setControlEnabled(enabled) {
  controlsEnabled = enabled;
  if (!enabled && sendTimer) clearTimeout(sendTimer);
  intensity.disabled = !enabled;
  releaseStop.disabled = !enabled;
}

function renderIntensity() {
  intensityOutput.textContent = `${intensity.value} / 20`;
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

function errorToText(error) {
  return error instanceof Error ? error.message : String(error);
}
