const healthOutput = document.querySelector('#health-output');
const tokenOutput = document.querySelector('#token-output');
const callbackOutput = document.querySelector('#callback-output');
const qrOutput = document.querySelector('#qr-output');
const sdkOutput = document.querySelector('#sdk-output');
const sdkEvents = [];
let currentSdk;

document.querySelector('#check-health').addEventListener('click', checkHealth);
document.querySelector('#refresh-callbacks').addEventListener('click', loadCallbacks);
document.querySelector('#host-form').addEventListener('submit', createHostSession);
document.querySelector('#check-app-status').addEventListener('click', checkAppStatus);
document.querySelector('#get-toys').addEventListener('click', getToys);
document.querySelector('#stop-toys').addEventListener('click', stopToys);

checkHealth();
loadCallbacks();

async function checkHealth() {
  healthOutput.textContent = 'Checking...';
  healthOutput.textContent = await getJsonText('/health');
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
  logSdkEvent('hostSessionRequested', payload);

  const formData = new FormData(event.currentTarget);
  const payload = {
    uid: formData.get('uid'),
    uname: formData.get('uname')
  };

  try {
    const response = await fetch('/api/lovense/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
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
    logSdkEvent('appStatusChange', data);
  });

  sdk.on('toyInfoChange', (data) => {
    logSdkEvent('toyInfoChange', data);
  });

  sdk.on('toyOnlineChange', (data) => {
    logSdkEvent('toyOnlineChange', data);
  });

  sdk.on('deviceInfoChange', (data) => {
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
    logSdkEvent('getToys', { onlineToys, toys });
  } catch (error) {
    logSdkEvent('getToysError', errorToText(error));
  }
}

async function stopToys() {
  if (!currentSdk) {
    logSdkEvent('stopError', 'Create a Lovense session first.');
    return;
  }

  try {
    const result = await currentSdk.stopToyAction();
    logSdkEvent('stopToyAction', result || 'sent');
  } catch (error) {
    logSdkEvent('stopError', errorToText(error));
  }
}

async function getJsonText(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return JSON.stringify(data, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
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
