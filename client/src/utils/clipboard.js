// Copy text to the clipboard with a fallback for non-secure contexts.
//
// The workshop UI is served over plain HTTP on a LAN IP (see vite.config.js),
// where `navigator.clipboard` is undefined — it only exists in secure contexts
// (HTTPS or localhost). So we try the async Clipboard API first and fall back
// to a hidden-textarea + document.execCommand('copy'), which works on http://.
//
// Returns true on success, false if both paths failed.
export async function copyToClipboard(text) {
    if (text == null) return false;
    const str = String(text);

    if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(str);
            return true;
        } catch {
            /* fall through to the execCommand path */
        }
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = str;
        ta.setAttribute('readonly', '');
        // Keep it off-screen but still selectable.
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, str.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}
