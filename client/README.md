# ComfyQ client

React + Vite frontend for ComfyQ — the multi-user middleware that lets students share a single ComfyUI rig through a scheduled job queue.

The client is one SPA with two user-facing modes (admin / student) plus live state from the Node server over Socket.IO.

## Tech stack

- **React 18** + **Vite 5** (HMR, plain HTTP — see "Running it" below)
- **Tailwind CSS 4** (PostCSS pipeline) + **lucide-react** icons
- **react-router-dom 7** for routing between pages
- **socket.io-client** for live job updates pushed from the server
- **vis-timeline** for the Scheduler's drag-and-drop time-grid
- **@tanstack/react-table** for the Dashboard job table

## Running it

Normally you don't run the client alone — `npm run dev` at the repo root starts both server + client under `concurrently` and is the supported path. Standalone is for client-only iteration:

```bash
npm install        # one-shot; postinstall also installs client/ and server/
npm run dev        # from repo root: server (3000) + client (5173) together

# client-only:
npm run dev --prefix client    # vite --host on 5173
npm run build  --prefix client # production build to client/dist
npm run lint   --prefix client # ESLint
```

Vite serves over plain HTTP and proxies every backend route + the Socket.IO channel to the Express server on `:3000`, so the page stays single-origin. HTTP is deliberate: a self-signed HTTPS cert can't be trusted across Safari/Chrome/mobile in a BYOD workshop without installing a CA on every device. The trade-off is that live in-browser webcam preview (`getUserMedia`) only works on `localhost`; off-localhost the camera button falls back to the device's native camera app via a file picker (`canUseLiveCamera()` in `MediaCaptureField.jsx` detects this automatically).

## Layout

```
src/
├── main.jsx                  app entry
├── App.jsx                   router + mode-aware shell
├── pages/
│   ├── AdminConfig.jsx       workflow upload + parameter selection + mode switch
│   ├── Scheduler.jsx         vis-timeline grid; booking, drag-reorder, collision viz
│   └── Dashboard.jsx         job table, filters, CSV export, admin actions
├── components/
│   ├── BookingDialog.jsx     parameter form + media inputs for a new job
│   ├── MyJobsPanel.jsx       per-user job list with status + actions
│   ├── WorkflowSelector.jsx  picker when multiple workflows are loaded
│   ├── UsernameModal.jsx     student identity gate
│   ├── ImageLightbox.jsx     result preview
│   ├── admin/                upload, parameter selector, config preview, meta editor
│   ├── capture/              media upload widget (MediaCaptureField — click + drag-and-drop)
│   └── ui/                   Button, Card, Modal, Toast, Badge, ConfirmDialog, ThemeToggle, WorkflowChip, MediaPreview
├── context/
│   ├── SocketContext.jsx     shared socket instance + live job/queue state
│   └── ThemeContext.jsx      light/dark
└── utils/
    ├── api.js                fetch wrappers for the Express API
    ├── imageResize.js        client-side downscale before upload
    ├── jobDisplay.js         status/format helpers for tables and panels
    └── userColor.js          deterministic per-user color (timeline, chips)
```

## Admin vs student

The mode is decided server-side from `config.json`; the client reads `/api/mode` at startup and routes accordingly:

- **Admin mode** (no config or `mode: "admin"`): `AdminConfig` is the landing page. Upload a workflow JSON, pick which parameters students can edit, set an admin password (optional), save — the server restarts in student mode.
- **Student mode** (`mode: "student"`): user is prompted for a name, lands on the Scheduler, can book jobs and watch them progress on the Dashboard.

## Notes for client development

- Live updates flow through `SocketContext` — don't poll the API for queue/job state, subscribe to socket events.
- Timeline collision detection runs on the client off `estimatedDurationSec` from `runtime.json` (server keeps that file warm via calibration runs).
- All paths inside the bundle assume `/` as base; the dev proxy and the prod static serve are both at the root of the Express server.
