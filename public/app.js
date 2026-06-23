const healthOutput = document.querySelector('#health-output');
const tokenOutput = document.querySelector('#token-output');
const callbackOutput = document.querySelector('#callback-output');
const qrOutput = document.querySelector('#qr-output');

document.querySelector('#check-health').addEventListener('click', checkHealth);
document.querySelector('#refresh-callbacks').addEventListener('click', loadCallbacks);
document.querySelector('#host-form').addEventListener('submit', createHostSession);

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

  const sdk = new window.LovenseBasicSdk({ uid, platform, authToken });

  sdk.on('ready', async (instance) => {
    try {
      const qr = await instance.getQrcode();
      const img = document.createElement('img');
      img.alt = 'Lovense Remote QR code';
      img.src = qr.qrcodeUrl;

      const code = document.createElement('pre');
      code.textContent = JSON.stringify(qr, null, 2);

      qrOutput.replaceChildren(img, code);
    } catch (error) {
      qrOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  sdk.on('sdkError', (data) => {
    qrOutput.textContent = JSON.stringify(data, null, 2);
  });

  sdk.on('toyInfoChange', (data) => {
    tokenOutput.textContent = JSON.stringify({ toyInfoChange: data }, null, 2);
  });
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
