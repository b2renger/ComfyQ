// SERVER_URL — origin the client targets for REST + Socket.IO.
//
// In dev, Vite proxies all backend routes (see vite.config.js), so the page,
// the API, and the websocket all share a single HTTPS origin. Same-origin
// means we don't need to know the hostname or protocol — relative paths
// just work, and the browser routes them through the proxy.
//
// VITE_SERVER_URL can still be set to override (e.g. for production deploys
// where the API is on a separate host). Leave it unset in dev.
const getServerUrl = () => {
    const envUrl = import.meta.env.VITE_SERVER_URL;
    if (envUrl && envUrl.trim() !== '') return envUrl;
    return ''; // same origin — Vite proxy handles the rest
};

export const SERVER_URL = getServerUrl();

// Helper functions for constructing URLs
export const getImageUrl = (filename) => `${SERVER_URL}/images/${filename}`;
export const getDownloadUrl = (filename) => `${SERVER_URL}/download/${filename}`;

// Media type helpers
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

export const isVideo = (filename) => {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
};

export const isImage = (filename) => {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
};
