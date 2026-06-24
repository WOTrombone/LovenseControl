# LovenseControl

LovenseControl is a mobile-first hosted web app for consensual control routing of Lovense toys.

The goal is to let a toy owner/host connect toys, approve invited controllers, assign each controller to a specific toy, and retain master safety controls including pause, STOP ALL, intensity caps, sensitivity limits, timeouts, and access revocation.

## Current Build

This is v0.19.3: per-toy safety caps, toy labels, offline-toy clarity, and host display-name persistence.

- `GET /health` confirms the Render service is alive.
- `POST /api/lovense/token` requests a Lovense user auth token from the server side.
- `POST /api/rooms/:roomId/lovense/session` creates a backend-owned Lovense Socket API session for that room.
- `POST /api/rooms/:roomId/lovense/command` sends a backend Socket API toy command for host-side tests.
- `POST /api/rooms/:roomId/safety` stores the host's routing toggle and intensity cap for backend routing.
- `POST /api/rooms/:roomId/toys/settings` stores a friendly label and app-level cap for a detected toy.
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
- `STOP ALL` clears the room's controller queues and sends a parallel hard-stop burst over both LAN and the Standard JS SDK when the browser fallback is active.
- Controller stop/inactive requests clear any stale live samples on the server.
- The host can assign each controller to a detected toy.
- Controllers can see which toy the host assigned to them.
- Controller requests are routed through the backend Lovense socket when connected, avoiding the host browser as the live-command relay.
- Backend socket routing respects the host's live-routing toggle and the assigned toy's cap.
- The old global cap remains as the default/fallback cap for newly detected toys.
- The host can label each toy with a friendly name and set a cap per toy.
- Controller assignment uses the friendly toy label, while the host still sees model/device details.
- Toy lists sort online toys first, then remembered/offline toys.
- Offline toys remain visible for labels/caps, but are marked remembered/offline and cannot be tested or assigned for live control.
- The host display name is saved to the room and shown on controller pages instead of the hardcoded Host label.
- The old browser SDK/LAN routing code remains in place as a fallback path while the backend socket path is tested.
- `STOP ALL` clears controller intents and sends backend socket stop/zero commands immediately.
- `STOP ALL` no longer disables live routing; the host can use the live-routing checkbox as the separate pause/resume control.
- The host page remembers the current room in browser storage and restores QR/socket/toy/controller state after back/refresh if the backend room still exists.
- The host page also writes the active room into the URL as `?room=...`, so refresh/back restores the exact same room instead of drifting to a different saved room.
- If Render lost the in-memory room, the host page now reports that the saved room expired instead of showing a misleading empty room.
- Create / Restore Room reuses the current/recovered room instead of creating a fresh room that has no Lovense session.

The next decision is whether to build pattern functionality now or do another small v0.19 stabilization pass after per-toy cap testing.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set `LOVENSE_DEVELOPER_TOKEN` in `.env` locally or in Render environment variables when deployed.

The backend socket path requires `socket.io-client` 2.x because Lovense's Standard Socket API requires the 2.x Socket.IO client.

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
7. Set different per-toy caps and labels.
8. Assign controllers to labeled toys.
9. Confirm backend routing enforces each assigned toy's cap.
10. Move to pattern functionality after per-toy cap behavior is confirmed.
