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

Vite serves over plain HTTP and proxies every backend route + the Socket.IO channel to the Express server on `:3000`, so the page stays single-origin. HTTP is deliberate: a self-signed HTTPS cert can't be trusted across Safari/Chrome/mobile in a BYOD workshop without installing a CA on every device. The trade-off is that secure-context-only browser APIs (`getUserMedia`, `navigator.clipboard`) don't work off-`localhost`, so ComfyQ avoids them: image/video/audio inputs are **file uploads** (`MediaCaptureField` — a phone's file picker still offers "Take Photo"), and clipboard writes go through the `execCommand('copy')` fallback in `utils/clipboard.js`. In-browser webcam capture was removed 2026-05-19 for this reason.

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
│   ├── DynamicParamFields.jsx shared exposed-parameter renderer (used by BookingDialog + the editor's live preview)
│   ├── MyJobsPanel.jsx       per-user job list with status + actions
│   ├── WorkflowSelector.jsx  picker when multiple workflows are loaded
│   ├── UsernameModal.jsx     student identity gate
│   ├── ImageLightbox.jsx     result preview
│   ├── admin/                upload, parameter selector, config preview, meta editor
│   ├── capture/              media inputs — MediaCaptureField (image/video/audio upload) + MaskDrawField (paint-a-mask in a fullscreen modal)
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

The server decides the mode when it boots, and `mode` in `config.json` does not choose it. A boot starts in admin mode. It starts in student mode only right after **Activate & serve** (or after a storyboard batch is queued while the machine is in admin mode, which serves the batch's first workflow), or when it finds the `server/data/.serving` marker that either leaves behind, so a machine that crashes or restarts while serving comes back serving the same workflow. **Stop serving** (Reset to admin) and the emergency stop remove that marker. The client asks `GET /admin/mode` for the running mode at startup and routes accordingly:

- **Admin mode**: `AdminConfig` is the landing page. Upload a workflow or pick one from the library, choose which parameters students can edit (Edit), optionally set an admin password, then press **Activate & serve** on its card (or *Activate & start student mode* at the bottom). Saving metadata or a password restarts nothing. Activate & serve from admin mode restarts the server in student mode. While the machine is already serving, select another card and press *Activate & start student mode* to switch the main workflow in place, without a restart (a card's *Serve alongside* adds a parallel lane instead). Stop serving / Reset to admin and Stop & kill all restart the server in admin mode.
- **Student mode**: the user is asked for a name and lands on the Scheduler, where they book jobs and follow them live on the result cards and the timeline. The Session Dashboard lists the jobs as a table you can filter and export.

## Notes for client development

- Live updates flow through `SocketContext` — don't poll the API for queue/job state, subscribe to socket events.
- Timeline collision detection runs on the client off `estimatedDurationSec` from `runtime.json` (server keeps that file warm via calibration runs).
- All paths inside the bundle assume `/` as base. The client is served by Vite, which proxies the backend routes to the Express server on `:3000`; Express does not serve the client build.
