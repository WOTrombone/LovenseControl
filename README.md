# LovenseControl

LovenseControl is a mobile-first hosted web app for consensual control routing of Lovense toys.

The goal is to let a toy owner/host connect toys, approve invited controllers, assign each controller to a specific toy, and retain master safety controls including pause, STOP ALL, intensity caps, sensitivity limits, timeouts, and access revocation.

## Current Build

This is v0.18: backend-socket responsiveness spike.

- `GET /health` confirms the Render service is alive.
- `POST /api/lovense/token` requests a Lovense user auth token from the server side.
- `POST /api/rooms/:roomId/lovense/session` creates a backend-owned Lovense Socket API session for that room.
- `POST /api/rooms/:roomId/lovense/command` sends a backend Socket API toy command for host-side tests.
- `POST /api/rooms/:roomId/safety` stores the host's routing toggle and intensity cap for backend routing.
- `POST /lovense/callback` accepts Lovense Standard API callback payloads for early testing.
- The browser page can request a host session, show the backend-generated Lovense QR code, show room/socket events, request app/toy status, and send a stop command.
- Token requests now fail with visible timeout errors instead of hanging.
- The top of the page now shows host-facing status cards and safety controls.
- `STOP ALL` is visible as soon as the SDK session exists.
- Host safety testing now has an intensity slider, `Test All`, and per-toy `Test This Toy` buttons.
- Diagnostics are tucked behind a collapsible panel.
- The host can create an in-memory controller room and copy a controller invite link.
- `/controller.html` lets a controller request access, wait for host approval, see the assigned toy, and use a mobile control-room style vertical live intensity slider.
- Fast slider wiggles collapse to the latest live level so the toy does not play delayed old slider positions.
- Slider input is coalesced on the controller page, so only the newest live level waits behind an in-flight send.
- Host and controller pages receive room updates over WebSocket instead of relying on the old 250ms host polling loop.
- Routed live vibration commands use indefinite `time: 0` commands instead of two-second command windows.
- When Lovense Remote reports a LAN endpoint, routed vibration prefers the local `https://{domain}:{httpsPort}/command` API and falls back to the Standard JS SDK if LAN fails.
- `STOP ALL` clears the room's controller queues, disables live routing, and sends a parallel hard-stop burst over both LAN and the Standard JS SDK.
- Controller stop/inactive requests clear any stale live samples on the server.
- The host can assign each controller to a detected toy.
- Controllers can see which toy the host assigned to them.
- Controller requests are routed through the backend Lovense socket when connected, avoiding the host browser as the live-command relay.
- Backend socket routing respects the host's live-routing toggle and intensity cap.
- The old browser SDK/LAN routing code remains in place as a fallback path while the backend socket path is tested.
- `STOP ALL` clears controller intents and sends backend socket stop/zero commands immediately.

The next decision is whether the backend Socket API path is responsive enough to become the only live routing path.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set `LOVENSE_DEVELOPER_TOKEN` in `.env` locally or in Render environment variables when deployed.

The v0.18 backend socket path requires `socket.io-client` 2.x because Lovense's Standard Socket API requires the 2.x Socket.IO client.

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
8. Test whether backend socket routing improves slider/STOP responsiveness.
9. If responsiveness is acceptable, simplify the host/controller UI around this path.
10. Add toy labels, solo mode, and then repeatable pattern editing.
