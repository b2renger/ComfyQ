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
// The one casualty is live in-browser webcam preview (getUserMedia needs
// a "secure context" off-localhost). The camera button falls back to the
// phone's native camera app via a file picker — see canUseLiveCamera() in
// MediaCaptureField.jsx, which already detects window.isSecureContext.
//
// We still proxy every backend route through Vite so the page stays
// single-origin. The Express/Socket.IO server runs on port 3000 — only
// ever reached via this proxy.
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
        secure: false,
        bypass(req) {
          const url = req.url || '';
          if (url === '/admin' || url.startsWith('/admin?') || url.startsWith('/admin#')) {
            return '/index.html';
          }
        }
      },
      '/workflows':    { target: BACKEND, changeOrigin: true, secure: false },
      '/jobs':         { target: BACKEND, changeOrigin: true, secure: false },
      '/upload':       { target: BACKEND, changeOrigin: true, secure: false },
      '/upload-image': { target: BACKEND, changeOrigin: true, secure: false },
      '/media':        { target: BACKEND, changeOrigin: true, secure: false },
      '/images':       { target: BACKEND, changeOrigin: true, secure: false },
      '/download':     { target: BACKEND, changeOrigin: true, secure: false },
      // Socket.IO: long-poll fallback + websocket upgrade both ride this prefix.
      '/socket.io':    { target: BACKEND, changeOrigin: true, secure: false, ws: true }
    }
  }
})
