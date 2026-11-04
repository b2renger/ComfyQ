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
        // Not `readonly`: iOS Safari will not select text in a read-only
        // field, so the copy silently copies nothing. 16px stops iOS zooming
        // in on focus; inputmode none keeps the keyboard down.
        ta.setAttribute('inputmode', 'none');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '0';
        ta.style.fontSize = '16px';
        ta.style.opacity = '0';
        const before = document.activeElement;
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        // WebKit on iOS needs an explicit range as well as select().
        try {
            const range = document.createRange();
            range.selectNodeContents(ta);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch { /* desktop browsers do not need it */ }
        ta.setSelectionRange(0, str.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (before && typeof before.focus === 'function') before.focus({ preventScroll: true });
        return ok;
    } catch {
        return false;
    }
}
