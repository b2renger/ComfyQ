import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

// A link that leaves ComfyQ, with a copy button beside it.
//
// Why the copy button: a link can fail to open for reasons the page cannot
// see — the Discovery desktop app's embedded view drops new-tab links when it
// was built without `allowpopups` (fixed in the app, but older installs stay
// out there), a school proxy blocks the site, a phone's in-app browser
// refuses new tabs. Copying the address and pasting it into a browser works
// in all of those cases, so every outgoing link carries the failsafe.
//
// The anchor is a plain <a href target=_blank>: no window.open, no
// preventDefault, so the browser treats it as the user's own navigation
// (WebKit's pop-up blocker only bites script-opened windows). Clicks stop
// propagating so a link inside a clickable card does not also open the card.

export const CopyLinkButton = ({ url, size = 11, className = '', label = 'Copy link' }) => {
    const [state, setState] = useState('idle');   // idle | ok | fail
    const copy = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await copyToClipboard(url);
        if (!ok) {
            // Last resort: a prompt shows the address selected, ready to copy
            // by hand — it works in every browser, clipboard access or not.
            window.prompt('Copy this link:', url);
        }
        setState(ok ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 1600);
    };
    return (
        <button
            type="button"   // these sit inside forms (the booking dialog) — never submit
            onClick={copy}
            title={state === 'ok' ? 'Link copied' : `${label} — paste it into your browser if the link does not open`}
            aria-label={label}
            className={`inline-flex items-center justify-center rounded p-0.5 text-muted hover:text-primary hover:bg-primary/10 transition-colors shrink-0 ${className}`}
        >
            {state === 'ok' ? <Check size={size} className="text-success" /> : <Copy size={size} />}
        </button>
    );
};

const ExternalLink = ({ href, children, className = '', title, copy = true, iconSize = 11 }) => {
    if (!href) return null;
    return (
        <span className="inline-flex items-center gap-0.5 max-w-full">
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={title || href}
                className={className}
            >
                {children}
            </a>
            {copy && <CopyLinkButton url={href} size={iconSize} />}
        </span>
    );
};

export default ExternalLink;
