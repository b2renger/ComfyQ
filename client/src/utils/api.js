const getServerUrl = () => {
    // First try environment variable (ensure it's not empty)
    const envUrl = import.meta.env.VITE_SERVER_URL;
    if (envUrl && envUrl.trim() !== '') {
        return envUrl;
    }

    // Otherwise, construct from current location (host) but use port 3000
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3000`;
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
