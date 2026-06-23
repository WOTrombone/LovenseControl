const healthOutput = document.querySelector('#health-output');
const tokenOutput = document.querySelector('#token-output');
const callbackOutput = document.querySelector('#callback-output');
const qrOutput = document.querySelector('#qr-output');
const sdkOutput = document.querySelector('#sdk-output');
const backendStatus = document.querySelector('#backend-status');
const appStatus = document.querySelector('#app-status');
const toyStatus = document.querySelector('#toy-status');
const toyList = document.querySelector('#toy-list');
const refreshStateButton = document.querySelector('#refresh-state');
const testVibrateButton = document.querySelector('#test-vibrate');
const testIntensity = document.querySelector('#test-intensity');
const testIntensityOutput = document.querySelector('#test-intensity-output');
const stopToysButton = document.querySelector('#stop-toys');
const controllerLink = document.querySelector('#controller-link');
const createRoomButton = document.querySelector('#create-room');
const controllersList = document.querySelector('#controllers-list');
const intensityCap = document.querySelector('#intensity-cap');
const routingEnabled = document.querySelector('#routing-enabled');
const sdkEvents = [];
let currentSdk;
let roomPollTimer;
const lastToyCommands = new Map();
let state = {
  backendOk: false,
  appConnected: false,
  toyOnline: false,
  toys: [],
  deviceInfo: null,
  room: null
};

document.querySelector('#check-health').addEventListener('click', checkHealth);
document.querySelector('#refresh-callbacks').addEventListener('click', loadCallbacks);
document.querySelector('#host-form').addEventListener('submit', createHostSession);
document.querySelector('#check-app-status').addEventListener('click', checkAppStatus);
document.querySelector('#get-toys').addEventListener('click', getToys);
refreshStateButton.addEventListener('click', refreshSdkState);
testVibrateButton.addEventListener('click', testVibrateAll);
testIntensity.addEventListener('input', () => {
  testIntensityOutput.textContent = `${clampIntensity(testIntensity.value)} / 20`;
});
toyList.addEventListener('click', handleToyListClick);
stopToysButton.addEventListener('click', stopToys);
createRoomButton.addEventListener('click', createRoom);
controllersList.addEventListener('click', handleControllerAction);
controllersList.addEventListener('change', handleControllerAssignment);
routingEnabled.addEventListener('change', () => {
  logSdkEvent('routingEnabledChange', routingEnabled.checked);
  if (!routingEnabled.checked) stopToys();
});

checkHealth();
loadCallbacks();
renderHostState();

async function checkHealth() {
  healthOutput.textContent = 'Checking...';
  try {
    const data = await getJson('/health');
    state = {
      ...state,
      backendOk: Boolean(data.ok)
    };
    healthOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    state = {
      ...state,
      backendOk: false
    };
    healthOutput.textContent = errorToText(error);
  }
  renderHostState();
}

async function loadCallbacks() {
  callbackOutput.textContent = 'Loading...';
  callbackOutput.textContent = await getJsonText('/api/lovense/callback-events');
}

async function createHostSession(event) {
  event.preventDefault();
  tokenOutput.textContent = 'Creating Lovense auth token...';
  qrOutput.hidden = true;
  qrOutput.replaceChildren();
  sdkEvents.length = 0;
  currentSdk = undefined;
  state = {
    ...state,
    appConnected: false,
    toyOnline: false,
    toys: [],
    deviceInfo: null
  };
  renderHostState();

  const formData = new FormData(event.currentTarget);
  const payload = {
    uid: formData.get('uid'),
    uname: formData.get('uname')
  };
  logSdkEvent('hostSessionRequested', payload);

  try {
    const response = await fetchWithTimeout('/api/lovense/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 15000);
    const data = await response.json();

    if (!response.ok) {
      tokenOutput.textContent = JSON.stringify(data, null, 2);
      return;
    }

    tokenOutput.textContent = JSON.stringify({
      uid: data.uid,
      uname: data.uname,
      platform: data.platform,
      authToken: data.authToken ? '[received]' : '[missing]'
    }, null, 2);

    await renderLovenseQr(data);
  } catch (error) {
    tokenOutput.textContent = error instanceof Error ? error.message : String(error);
    logSdkEvent('tokenRequestError', errorToText(error));
  }
}

async function renderLovenseQr({ uid, platform, authToken }) {
  if (!window.LovenseBasicSdk) {
    qrOutput.hidden = false;
    qrOutput.textContent = 'Lovense JS SDK did not load.';
    return;
  }

  qrOutput.hidden = false;
  qrOutput.textContent = 'Requesting QR code from Lovense SDK...';

  const sdk = new window.LovenseBasicSdk({ uid, platform, authToken, debug: true });
  currentSdk = sdk;
  renderHostState();

  sdk.on('ready', async (instance) => {
    currentSdk = instance;
    logSdkEvent('ready');

    try {
      const qr = await instance.getQrcode();
      const img = document.createElement('img');
      img.alt = 'Lovense Remote QR code';
      img.src = qr.qrcodeUrl;

      const code = document.createElement('pre');
      code.textContent = JSON.stringify(qr, null, 2);

      qrOutput.replaceChildren(img, code);
      logSdkEvent('qrcode', {
        code: qr.code,
        hasQrcodeUrl: Boolean(qr.qrcodeUrl)
      });
    } catch (error) {
      qrOutput.textContent = error instanceof Error ? error.message : String(error);
      logSdkEvent('qrcodeError', errorToText(error));
    }
  });

  sdk.on('sdkError', (data) => {
    qrOutput.textContent = JSON.stringify(data, null, 2);
    logSdkEvent('sdkError', data);
  });

  sdk.on('appStatusChange', (data) => {
    state = {
      ...state,
      appConnected: Boolean(data)
    };
    renderHostState();
    logSdkEvent('appStatusChange', data);
  });

  sdk.on('toyInfoChange', (data) => {
    state = {
      ...state,
      toys: normalizeToyList(data),
      toyOnline: normalizeToyList(data).some((toy) => toy.connected)
    };
    renderHostState();
    logSdkEvent('toyInfoChange', data);
  });

  sdk.on('toyOnlineChange', (data) => {
    state = {
      ...state,
      toyOnline: Boolean(data)
    };
    renderHostState();
    logSdkEvent('toyOnlineChange', data);
  });

  sdk.on('deviceInfoChange', (data) => {
    state = {
      ...state,
      appConnected: true,
      deviceInfo: data
    };
    renderHostState();
    logSdkEvent('deviceInfoChange', data);
  });
}

async function checkAppStatus() {
  if (!currentSdk) {
    logSdkEvent('appStatusError', 'Create a Lovense session first.');
    return;
  }

  try {
    const status = await currentSdk.getAppStatus();
    state = {
      ...state,
      appConnected: Boolean(status)
    };
    renderHostState();
    logSdkEvent('getAppStatus', status);
  } catch (error) {
    logSdkEvent('getAppStatusError', errorToText(error));
  }
}

async function getToys() {
  if (!currentSdk) {
    logSdkEvent('getToysError', 'Create a Lovense session first.');
    return;
  }

  try {
    const onlineToys = await currentSdk.getOnlineToys();
    const toys = await currentSdk.getToys();
    const normalizedToys = normalizeToyList(toys);
    state = {
      ...state,
      toys: normalizedToys,
      toyOnline: normalizeToyList(onlineToys).length > 0 || normalizedToys.some((toy) => toy.connected)
    };
    renderHostState();
    await applyControllerIntent();
    logSdkEvent('getToys', { onlineToys, toys });
  } catch (error) {
    logSdkEvent('getToysError', errorToText(error));
  }
}

async function refreshSdkState() {
  await checkAppStatus();
  await getToys();
}

async function stopToys() {
  if (!currentSdk) {
    logSdkEvent('stopError', 'Create a Lovense session first.');
    return;
  }

  try {
    const result = await currentSdk.stopToyAction();
    lastToyCommands.clear();
    logSdkEvent('stopToyAction', result || 'sent');
    await getToys();
  } catch (error) {
    logSdkEvent('stopError', errorToText(error));
  }
}

async function createRoom() {
  createRoomButton.disabled = true;
  createRoomButton.textContent = 'Creating...';

  try {
    const hostName = document.querySelector('[name="uname"]').value || 'Host';
    const response = await fetchWithTimeout('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName })
    }, 10000);
    const room = await response.json();

    if (!response.ok) {
      throw new Error(room.error || 'Could not create room.');
    }

    state = {
      ...state,
      room
    };
    const url = new URL('/controller.html', window.location.origin);
    url.searchParams.set('room', room.id);
    url.searchParams.set('name', 'Controller');
    controllerLink.value = url.toString();
    logSdkEvent('roomCreated', { room: room.id });
    renderControllers();
    startRoomPolling();
  } catch (error) {
    controllersList.textContent = errorToText(error);
    logSdkEvent('roomCreateError', errorToText(error));
  } finally {
    createRoomButton.disabled = false;
    createRoomButton.textContent = 'Create Room';
  }
}

function startRoomPolling() {
  if (roomPollTimer) clearInterval(roomPollTimer);
  roomPollTimer = setInterval(pollRoom, 1000);
  pollRoom();
}

async function pollRoom() {
  if (!state.room?.id) return;

  try {
    const room = await getJson(`/api/rooms/${state.room.id}`);
    state = {
      ...state,
      room
    };
    renderControllers();
    await applyControllerIntent();
  } catch (error) {
    logSdkEvent('roomPollError', errorToText(error));
  }
}

async function handleControllerAction(event) {
  const button = event.target.closest('button[data-controller-id]');
  if (!button || !state.room?.id) return;

  const controllerId = button.dataset.controllerId;
  const action = button.dataset.action;
  const approved = action === 'approve';

  try {
    const response = await fetchWithTimeout(`/api/rooms/${state.room.id}/controllers/${controllerId}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved,
        revoked: action === 'revoke'
      })
    }, 10000);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Controller update failed.');
    }

    logSdkEvent('controllerApproval', {
      controller: data.name,
      approved: data.approved,
      revoked: data.revoked
    });
    await pollRoom();
  } catch (error) {
    logSdkEvent('controllerApprovalError', errorToText(error));
  }
}

function renderControllers() {
  if (!state.room) {
    controllersList.textContent = 'No controller room yet.';
    return;
  }

  if (state.room.controllers.length === 0) {
    controllersList.textContent = 'Room is open. Waiting for a controller to request access.';
    return;
  }

  controllersList.replaceChildren(...state.room.controllers.map(renderController));
}

function renderController(controller) {
  const item = document.createElement('div');
  item.className = 'controller-item';

  const info = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = controller.name || 'Controller';
  const details = document.createElement('span');
  const assignedToy = toyById(controller.assignedToyId);
  details.textContent = [
    controller.revoked ? 'revoked' : controller.approved ? 'approved' : 'pending',
    assignedToy ? `assigned to ${toyLabel(assignedToy)}` : 'no toy assigned',
    controller.intent?.active ? `requesting ${controller.intent.intensity}/20` : 'idle'
  ].join(' · ');
  info.append(name, details);

  const assignment = document.createElement('label');
  assignment.className = 'assignment-label';
  assignment.textContent = 'Assign toy';

  const select = document.createElement('select');
  select.dataset.controllerId = controller.id;
  select.disabled = controller.revoked || state.toys.length === 0;

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.toys.length === 0 ? 'No toys detected' : 'Choose toy';
  select.append(empty);

  state.toys.forEach((toy) => {
    const option = document.createElement('option');
    option.value = toy.id;
    option.textContent = toyLabel(toy);
    option.disabled = !toy.connected || !toy.id;
    select.append(option);
  });
  select.value = controller.assignedToyId || '';
  assignment.append(select);

  const actions = document.createElement('div');
  actions.className = 'button-row';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.textContent = 'Approve';
  approve.disabled = controller.approved && !controller.revoked;
  approve.dataset.action = 'approve';
  approve.dataset.controllerId = controller.id;

  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.textContent = 'Revoke';
  revoke.className = 'danger-button';
  revoke.disabled = controller.revoked;
  revoke.dataset.action = 'revoke';
  revoke.dataset.controllerId = controller.id;

  actions.append(approve, revoke);
  item.append(info, assignment, actions);
  return item;
}

async function handleControllerAssignment(event) {
  const select = event.target.closest('select[data-controller-id]');
  if (!select || !state.room?.id) return;

  try {
    const selectedToy = toyById(select.value);
    const response = await fetchWithTimeout(`/api/rooms/${state.room.id}/controllers/${select.dataset.controllerId}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignedToyId: select.value,
        assignedToyName: selectedToy ? toyLabel(selectedToy) : ''
      })
    }, 10000);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Controller assignment failed.');
    }

    logSdkEvent('controllerAssignment', {
      controller: data.name,
      assignedToyId: data.assignedToyId || '[none]',
      assignedToyName: data.assignedToyName || '[none]'
    });
    await pollRoom();
  } catch (error) {
    logSdkEvent('controllerAssignmentError', errorToText(error));
  }
}

async function applyControllerIntent() {
  if (!currentSdk || !state.room || !routingEnabled.checked) return;

  if (!state.toyOnline) {
    logSdkEvent('routingBlocked', 'No online toy detected.');
    return;
  }

  const activeToyIds = new Set();
  const onlineToyIds = new Set(connectedToys().map((toy) => toy.id).filter(Boolean));
  const now = Date.now();
  const routes = state.room.controllers.filter((controller) => {
    return controller.approved
      && !controller.revoked
      && controller.assignedToyId
      && onlineToyIds.has(controller.assignedToyId)
      && controller.intent?.active
      && controller.intent.intensity > 0;
  });

  for (const controller of routes) {
    if (activeToyIds.has(controller.assignedToyId)) continue;

    const desired = Math.min(clampIntensity(intensityCap.value), clampIntensity(controller.intent.intensity));
    const previous = lastToyCommands.get(controller.assignedToyId);
    const shouldSend = !previous
      || desired !== previous.intensity
      || controller.id !== previous.controllerId
      || now - previous.at > 1500;

    activeToyIds.add(controller.assignedToyId);
    if (!shouldSend || desired <= 0) continue;

    const command = {
      vibrate: desired,
      time: 2,
      toyId: controller.assignedToyId
    };
    const toy = toyById(controller.assignedToyId);

    try {
      const result = await currentSdk.sendToyCommand(command);
      lastToyCommands.set(controller.assignedToyId, {
        intensity: desired,
        controllerId: controller.id,
        at: now
      });
      logSdkEvent('routedControllerIntent', {
        controller: controller.name,
        requested: controller.intent.intensity,
        sent: desired,
        target: toy ? summarizeToyTargets([toy])[0] : controller.assignedToyId,
        result: result || 'sent'
      });
    } catch (error) {
      logSdkEvent('routingError', errorToText(error));
    }
  }

  for (const [toyId] of lastToyCommands) {
    if (!activeToyIds.has(toyId)) {
      await stopToy(toyId);
    }
  }
}

async function stopToy(toyId) {
  try {
    const command = {
      vibrate: 0,
      time: 2,
      toyId
    };
    const result = await currentSdk.sendToyCommand(command);
    lastToyCommands.delete(toyId);
    logSdkEvent('routedToyStop', {
      toyId,
      result: result || 'sent'
    });
  } catch (error) {
    logSdkEvent('routingStopError', errorToText(error));
  }
}

async function handleToyListClick(event) {
  const button = event.target.closest('button[data-test-toy-id]');
  if (!button) return;
  await testVibrateToy(button.dataset.testToyId);
}

async function testVibrateAll() {
  if (!currentSdk) {
    logSdkEvent('testVibrateError', 'Create a Lovense session first.');
    return;
  }

  if (!state.toyOnline) {
    logSdkEvent('testVibrateBlocked', 'No online toy detected.');
    return;
  }

  try {
    const targets = connectedToys();
    const command = testCommand();

    const result = await currentSdk.sendToyCommand(command);
    logSdkEvent('testVibrateAll', {
      command,
      targets: summarizeToyTargets(targets),
      result: result || 'sent'
    });
  } catch (error) {
    logSdkEvent('testVibrateError', errorToText(error));
  }
}

async function testVibrateToy(toyId) {
  if (!currentSdk) {
    logSdkEvent('testVibrateError', 'Create a Lovense session first.');
    return;
  }

  const toy = state.toys.find((candidate) => candidate.id === toyId);
  if (!toy?.connected) {
    logSdkEvent('testVibrateBlocked', 'That toy is not online.');
    return;
  }

  try {
    const command = {
      ...testCommand(),
      toyId
    };
    const result = await currentSdk.sendToyCommand(command);
    logSdkEvent('testVibrateToy', {
      command,
      target: summarizeToyTargets([toy])[0],
      result: result || 'sent'
    });
  } catch (error) {
    logSdkEvent('testVibrateError', errorToText(error));
  }
}

function testCommand() {
  return {
    vibrate: clampIntensity(testIntensity.value),
    time: 2
  };
}

async function getJsonText(url) {
  try {
    const data = await getJson(url);
    return JSON.stringify(data, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function getJson(url) {
  const response = await fetchWithTimeout(url, {}, 10000);
  return response.json();
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
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function logSdkEvent(type, data = null) {
  sdkEvents.unshift({
    at: new Date().toLocaleTimeString(),
    type,
    data
  });
  sdkEvents.length = Math.min(sdkEvents.length, 20);
  sdkOutput.textContent = JSON.stringify(sdkEvents, null, 2);
}

function errorToText(error) {
  return error instanceof Error ? error.message : String(error);
}

function renderHostState() {
  backendStatus.textContent = state.backendOk ? 'Online' : 'Not checked';
  backendStatus.className = state.backendOk ? 'good' : 'warn';

  appStatus.textContent = state.appConnected ? 'Connected' : 'Not connected';
  appStatus.className = state.appConnected ? 'good' : 'warn';

  toyStatus.textContent = state.toyOnline ? 'Online' : 'No toy detected';
  toyStatus.className = state.toyOnline ? 'good' : 'warn';

  stopToysButton.disabled = !currentSdk;
  testVibrateButton.disabled = !currentSdk || !state.toyOnline;

  if (state.toys.length === 0) {
    toyList.textContent = state.appConnected
      ? 'Lovense Remote is connected. No online toys detected yet.'
      : 'Connect Lovense Remote to check toys.';
    return;
  }

  toyList.replaceChildren(...state.toys.map(renderToy));
}

function renderToy(toy) {
  const item = document.createElement('div');
  item.className = 'toy-item';

  const info = document.createElement('div');
  info.className = 'toy-info';

  const name = document.createElement('strong');
  name.textContent = toy.nickname || toy.name || toy.toyType || 'Lovense toy';

  const details = document.createElement('span');
  details.textContent = [
    toy.connected ? 'online' : 'offline',
    formatBattery(toy.battery),
    toy.id ? `id ${toy.id}` : null
  ].filter(Boolean).join(' · ');

  info.append(name, details);

  const actions = document.createElement('div');
  actions.className = 'button-row';

  const test = document.createElement('button');
  test.type = 'button';
  test.textContent = 'Test This Toy';
  test.disabled = !toy.connected || !toy.id;
  test.dataset.testToyId = toy.id;

  actions.append(test);
  item.append(info, actions);
  return item;
}

function connectedToys() {
  const toys = state.toys.filter((toy) => toy.connected);
  return toys.length > 0 ? toys : state.toys;
}

function toyById(toyId) {
  return state.toys.find((toy) => toy.id === toyId);
}

function toyLabel(toy) {
  return toy.nickname || toy.name || toy.toyType || toy.id || 'Lovense toy';
}

function summarizeToyTargets(toys) {
  if (toys.length === 0) return ['all connected toys'];
  return toys.map((toy) => ({
    id: toy.id,
    name: toyLabel(toy)
  }));
}

function formatBattery(value) {
  if (value === undefined || value === null || value === 0) return 'battery unknown';
  return `${value}% battery`;
}

function normalizeToyList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : Object.values(value);
  return list.filter(Boolean).map((toy) => ({
    id: toy.id || toy.toyId || '',
    name: toy.name || '',
    toyType: toy.toyType || toy.type || '',
    nickname: toy.nickname || toy.nickName || '',
    battery: toy.battery,
    connected: toy.connected === undefined ? toy.status === 1 || toy.status === '1' : Boolean(toy.connected)
  }));
}

function clampIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(20, Math.round(number)));
}
