# LovenseControl

LovenseControl is a mobile-first hosted web app for consensual control routing of Lovense toys.

The goal is to let a toy owner/host connect toys, approve invited controllers, assign each controller to a specific toy, and retain master safety controls including pause, STOP ALL, intensity caps, sensitivity limits, timeouts, and access revocation.

## Current Build

This is v0.3: a connection spike.

- `GET /health` confirms the Render service is alive.
- `POST /api/lovense/token` requests a Lovense user auth token from the server side.
- `POST /lovense/callback` accepts Lovense Standard API callback payloads for early testing.
- The browser page can request a host session, ask the Lovense Standard JS SDK for a QR code, show SDK events, request app/toy status, and send a stop command.
- Token requests now fail with visible timeout errors instead of hanging.

No real controller routing is implemented yet.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set `LOVENSE_DEVELOPER_TOKEN` in `.env` locally or in Render environment variables when deployed.

Do not commit `.env`, Lovense developer tokens, AES keys, Render secrets, or GitHub tokens.

## Render

Use a Render Web Service.

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Required environment variables:

- `LOVENSE_DEVELOPER_TOKEN`
- `LOVENSE_PLATFORM`

For the Standard API callback test, set the Lovense Developer Dashboard callback URL to:

```text
https://your-render-service.onrender.com/lovense/callback
```

## Next Steps

1. Deploy the backend and confirm `/health`.
2. Configure `LOVENSE_DEVELOPER_TOKEN` and `LOVENSE_PLATFORM` in Render.
3. Create a host session from the web page.
4. Scan the QR code in Lovense Remote.
5. Confirm toy connection/callback behavior.
6. Add STOP ALL before adding any controller controls.
