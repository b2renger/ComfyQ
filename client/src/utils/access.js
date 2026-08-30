// Access token — proof that this browser knows the machine's access password.
//
// A rig can be locked by its admin (Admin → "Student access") so only the group
// that knows the password can generate on it. The client exchanges the password
// for a token once (POST /access/login), keeps the token in localStorage, and
// replays it on the socket handshake, uploads and job listing. The plaintext
// password is never stored.
//
// The token is derived from the stored password hash, so changing or clearing
// the password on the server invalidates every token already handed out — a
// stale one simply fails the next /access/status check and the gate reappears.

const KEY = 'comfyq_access_token';

export const getAccessToken = () => {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};

export const setAccessToken = (token) => {
    try {
        if (token) localStorage.setItem(KEY, token);
        else localStorage.removeItem(KEY);
    } catch { /* private mode — the session just re-prompts */ }
};

export const clearAccessToken = () => setAccessToken('');

// Spread into a fetch's headers. Empty object on an open machine.
export const accessHeaders = () => {
    const token = getAccessToken();
    return token ? { 'X-Access-Token': token } : {};
};

// For plain <a href> downloads, which can't carry a header.
export const withAccessToken = (url) => {
    const token = getAccessToken();
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
};
