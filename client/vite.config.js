import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS in dev — required so getUserMedia (webcam / mobile camera) works
// over the LAN. Browsers refuse `navigator.mediaDevices.getUserMedia` on any
// non-loopback origin served over plain http://. The cert is self-signed and
// generated in memory on each boot; every device that opens the URL has to
// click through a one-time "unsafe site" warning, then media capture works.
//
// We also proxy every backend route through Vite so the page stays single-
// origin HTTPS. The Express/Socket.IO server keeps running on plain http
// (port 3000) — it's only ever reached via this proxy.
const BACKEND = 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,           // 0.0.0.0 — accept LAN connections
    https: true,
    proxy: {
      // `/admin` is overloaded: the React app owns the bare path
      // (https://localhost:5173/admin), the Express backend owns every
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
