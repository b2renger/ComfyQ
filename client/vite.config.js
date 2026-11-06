import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain HTTP in dev — deliberately. A self-signed HTTPS cert (the old
// @vitejs/plugin-basic-ssl setup) cannot be made to "just work" across
// Safari + Chrome + phones in a BYOD workshop: every device hits an
// "unsafe site" warning, Safari refuses to extend that trust to the
// websocket and to downloads, and the cert is regenerated every boot.
// HTTP removes all of that friction — uploads, downloads, the timeline,
// and the websocket behave identically everywhere.
//
// The one casualty was live in-browser webcam capture (getUserMedia needs
// a "secure context" off-localhost), so it was removed (2026-05-19): image,
// video and audio inputs are file uploads (MediaCaptureField.jsx), and a
// phone's file picker still offers its camera.
//
// We still proxy every backend route through Vite so the page stays
// single-origin. The Express/Socket.IO server runs on port 3000. Browsers
// reach it only through this proxy, but it listens on all interfaces
// (server.host 0.0.0.0) because ComfyQ Discovery's subnet sweep calls
// http://<ip>:3000/federation/self directly — binding it to 127.0.0.1 would
// hide the machine from Discovery. `xfwd` adds X-Forwarded-For with each
// browser's own address; the server trusts that header from loopback only
// (server/index.js, 'trust proxy'), which is what lets the admin-mode
// "users connected" count tell browsers apart.
const BACKEND = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,           // 0.0.0.0 — accept LAN connections
    proxy: {
      // `/admin` is overloaded: the React app owns the bare path
      // (http://localhost:5173/admin), the Express backend owns every
      // sub-path (`/admin/mode`, `/admin/config`, etc). Without bypass,
      // Vite proxies the bare path to Express, which has no handler for
      // it — returning 404 and a blank page where the SPA should be.
      '/admin': {
        target: BACKEND,
        changeOrigin: true,
        xfwd: true,
        secure: false,
        bypass(req) {
          const url = req.url || '';
          if (url === '/admin' || url.startsWith('/admin?') || url.startsWith('/admin#')) {
            return '/index.html';
          }
        }
      },
      // Access-password handshake (/access/status, /access/login) — the client
      // asks this before it may connect to a reserved machine.
      '/access':       { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/workflows':    { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      // Storyboard batch upload (parse / preview / queue a whole document).
      '/storyboard':   { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/jobs':         { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/upload':       { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/upload-image': { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/input-media':  { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/media':        { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/images':       { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      '/download':     { target: BACKEND, changeOrigin: true, xfwd: true, secure: false },
      // Socket.IO: long-poll fallback + websocket upgrade both ride this prefix.
      '/socket.io':    { target: BACKEND, changeOrigin: true, xfwd: true, secure: false, ws: true }
    }
  }
})
