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
// Serve a user-uploaded INPUT file (ComfyUI/input/comfyq_*) — used to preview
// an asset reused from a prior job in "Use these settings".
export const getInputUrl = (filename) => `${SERVER_URL}/input-media/${encodeURIComponent(filename)}`;
// Download a job's "ingredients" — imported media + a settings.json snapshot
// (workflow id, every parameter, the seed, the prompt) — as one .zip, to
// relaunch the job later even after the machine switched to another workflow.
export const getIngredientsUrl = (jobId) => `${SERVER_URL}/jobs/${encodeURIComponent(jobId)}/ingredients.zip`;

// Media type helpers
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const MODEL3D_EXTENSIONS = ['glb', 'gltf'];
// Gaussian-splat container formats handled by SplatViewer (Spark), not GLTFLoader.
const SPLAT_EXTENSIONS = ['spz', 'splat', 'ksplat'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'];

const extOf = (filename) => (filename ? filename.split('.').pop().toLowerCase() : '');

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

// 3D model — only formats with a real browser loader (GLTFLoader). OBJ/FBX/PLY
// are recognised server-side but the inline viewer would need extra loaders.
export const isModel3d = (filename) => MODEL3D_EXTENSIONS.includes(extOf(filename));

// Gaussian splat — rendered by SplatViewer (Spark). `.spz` is what TripoSplat
// ships as its headline splat; `.splat`/`.ksplat` are also recognised.
export const isSplat = (filename) => SPLAT_EXTENSIONS.includes(extOf(filename));

// Audio — rendered by AudioPlayer (<audio> element).
export const isAudio = (filename) => AUDIO_EXTENSIONS.includes(extOf(filename));
