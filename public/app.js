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
const stopToysButton = document.querySelector('#stop-toys');
const controllerLink = document.querySelector('#controller-link');
const sdkEvents = [];
let currentSdk;
let state = {
  backendOk: false,
  appConnected: false,
  toyOnline: false,
  toys: [],
  deviceInfo: null
};

document.querySelector('#check-health').addEventListener('click', checkHealth);
document.querySelector('#refresh-callbacks').addEventListener('click', loadCallbacks);
document.querySelector('#host-form').addEventListener('submit', createHostSession);
document.querySelector('#check-app-status').addEventListener('click', checkAppStatus);
document.querySelector('#get-toys').addEventListener('click', getToys);
refreshStateButton.addEventListener('click', refreshSdkState);
testVibrateButton.addEventListener('click', testVibrate);
stopToysButton.addEventListener('click', stopToys);
document.querySelector('#create-controller-link').addEventListener('click', createControllerLink);

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
    logSdkEvent('stopToyAction', result || 'sent');
    await getToys();
  } catch (error) {
    logSdkEvent('stopError', errorToText(error));
  }
}

async function testVibrate() {
  if (!currentSdk) {
    logSdkEvent('testVibrateError', 'Create a Lovense session first.');
    return;
  }

  if (!state.toyOnline) {
    logSdkEvent('testVibrateBlocked', 'No online toy detected.');
    return;
  }

  try {
    const firstToy = state.toys.find((toy) => toy.connected) || state.toys[0];
    const command = {
      vibrate: 1,
      time: 2
    };
    if (firstToy?.id) command.toyId = firstToy.id;

    const result = await currentSdk.sendToyCommand(command);
    logSdkEvent('testVibrate1of20', result || command);
  } catch (error) {
    logSdkEvent('testVibrateError', errorToText(error));
  }
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

  const name = document.createElement('strong');
  name.textContent = toy.nickname || toy.name || toy.toyType || 'Lovense toy';

  const details = document.createElement('span');
  details.textContent = [
    toy.connected ? 'online' : 'offline',
    formatBattery(toy.battery),
    toy.id ? `id ${toy.id}` : null
  ].filter(Boolean).join(' · ');

  item.append(name, details);
  return item;
}

function createControllerLink() {
  const roomId = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8);
  const url = new URL('/controller.html', window.location.origin);
  url.searchParams.set('name', 'Bob');
  url.searchParams.set('room', roomId);
  controllerLink.href = url.toString();
  controllerLink.textContent = url.toString();
  logSdkEvent('controllerPreviewLinkCreated', { controller: 'Bob', room: roomId });
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
