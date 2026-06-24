# LovenseControl

LovenseControl is a mobile-first hosted web app for consensual control routing of Lovense toys.

The goal is to let a toy owner/host connect toys, approve invited controllers, assign each controller to a specific toy, and retain master safety controls including pause, STOP ALL, intensity caps, sensitivity limits, timeouts, and access revocation.

## Current Build

This is v0.14: controller-visible assignment with gesture replay.

- `GET /health` confirms the Render service is alive.
- `POST /api/lovense/token` requests a Lovense user auth token from the server side.
- `POST /lovense/callback` accepts Lovense Standard API callback payloads for early testing.
- The browser page can request a host session, ask the Lovense Standard JS SDK for a QR code, show SDK events, request app/toy status, and send a stop command.
- Token requests now fail with visible timeout errors instead of hanging.
- The top of the page now shows host-facing status cards and safety controls.
- `STOP ALL` is visible as soon as the SDK session exists.
- Host safety testing now has an intensity slider, `Test All`, and per-toy `Test This Toy` buttons.
- Diagnostics are tucked behind a collapsible panel.
- The host can create an in-memory controller room and copy a controller invite link.
- `/controller.html` lets a controller request access, wait for host approval, see the assigned toy, and use a mobile control-room style vertical live intensity slider.
- Fast slider wiggles are sent as queued gesture samples so the host can replay them to the assigned toy instead of collapsing them to the latest level.
- The host can assign each controller to a detected toy.
- Controllers can see which toy the host assigned to them.
- Controller requests are routed through the host page to the assigned toy only, where the host's routing toggle, intensity cap, and STOP ALL remain in control.

Repeating pattern controls come next.

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
6. Create a controller room and approve a controller.
7. Test controller requests with the host cap low.
8. Add a repeatable pattern editor with STOP ALL as the hard override.
