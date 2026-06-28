// ComfyQ Fleet Monitor — renderer.
// Receives machine snapshots over the `fleet` bridge and renders one card each.
// No inline handlers (CSP) — listeners are attached after render.

const appEl = document.getElementById('app');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const subtitleEl = document.getElementById('subtitle');
const bannerEl = document.getElementById('banner');
const peerChipsEl = document.getElementById('peerChips');
const addPeerForm = document.getElementById('addPeerForm');
const peerInput = document.getElementById('peerInput');
const autoScanChk = document.getElementById('autoScanChk');
const scanStatusEl = document.getElementById('scanStatus');
const rescanBtn = document.getElementById('rescanBtn');
const rangeBase = document.getElementById('rangeBase');
const rangeT0 = document.getElementById('rangeT0');
const rangeT1 = document.getElementById('rangeT1');
const rangeF0 = document.getElementById('rangeF0');
const rangeF1 = document.getElementById('rangeF1');
const rangeApply = document.getElementById('rangeApply');
const settingsBtn = document.getElementById('settingsBtn');
const themeBtn = document.getElementById('themeBtn');
const controlsEl = document.getElementById('controls');
const toastEl = document.getElementById('toast');

// Light / dark theme — same behaviour as the ComfyQ web client (honor the OS
// preference first, then remember the user's choice).
function applyTheme(t) {
    const el = document.documentElement;
    el.classList.remove('dark', 'light');
    el.classList.add(t === 'light' ? 'light' : 'dark');
}
function initTheme() {
    let t = null;
    try { t = localStorage.getItem('comfyq-fleet-theme'); } catch { /* ignore */ }
    if (t !== 'light' && t !== 'dark') {
        t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    applyTheme(t);
}
initTheme();
themeBtn.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('comfyq-fleet-theme', next); } catch { /* ignore */ }
});

// Category → icon, matching the ComfyQ admin workflow library (lucide icons):
//   t2i→wand, image-edit/i2i→image, i2v→video, audio→music, 3d/preprocessor→box,
//   description→file-text, else→grid. Gives an at-a-glance cue of what the
//   served workflow does.
const ICON = {
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'
};
const CAT_ICON = {
    't2i': 'wand', 'image-edit': 'image', 'i2i': 'image', 'i2v': 'video',
    'audio': 'music', '3d': 'box', 'preprocessor': 'box', 'description': 'file'
};
function catIconSvg(category) {
    const body = ICON[CAT_ICON[category] || 'grid'] || ICON.grid;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

let toastTimer = null;
function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 1800);
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clock(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
}
function mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ago(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    return `${Math.floor(s / 3600)} h ago`;
}
function idleText(sec) {
    if (sec == null) return 'unknown';
    if (sec < 20) return 'active now';
    if (sec < 3600) return `quiet for ${Math.max(1, Math.floor(sec / 60))} min`;
    return `quiet for ${Math.floor(sec / 3600)} h`;
}

function classify(p) {
    if (p._stale) return 'stale';
    if (p.mode === 'student' && p.comfy && p.comfy.running && p.activeWorkflow) return 'serving';
    if (p.comfy && p.comfy.running) return 'backend';
    return 'idle';
}
const ORDER = { serving: 0, backend: 1, idle: 2, stale: 3 };

// Plain-language one-liner for the machine's state.
function stateLabel(p, kind) {
    if (kind === 'stale') return 'Not responding';
    if (kind === 'serving') return 'Running a workflow';
    if (p.mode === 'admin') return 'On standby (admin)';
    if (p.comfy && p.comfy.running) return 'Ready';
    return 'Ready (engine off)';
}

function jobRow(j, running) {
    const time = running
        ? (j.startedAt ? `running · ${mmss(Date.now() - j.startedAt)}` : 'running')
        : `at ${clock(j.scheduledAt)}`;
    return `
        <div class="job${running ? ' running' : ''}">
            <div class="job-top">
                <span class="job-user">${esc(j.user || 'someone')}</span>
                <span class="job-time">${esc(time)}</span>
            </div>
            <div class="job-prompt">${esc(j.prompt || '(no prompt)')}</div>
        </div>`;
}

function cardHtml(p, selfIps) {
    const kind = classify(p);
    const ip = (p.ips && p.ips[0]) || '';
    const uiPort = p.uiPort || 5173;
    const url = ip ? `http://${ip}:${uiPort}` : '';
    const adminUrl = ip ? `http://${ip}:${uiPort}/admin` : '';
    const isServing = kind === 'serving';
    const isAdmin = p.mode === 'admin';
    const isSelf = (p.ips || []).some(x => (selfIps || []).includes(x));

    const hw = [];
    if (p.gpu) hw.push(`<span class="chip">${esc(p.gpu)}${p.vramGb ? ` · ${p.vramGb} GB` : ''}</span>`);
    if (p.ramGb) hw.push(`<span class="chip">${esc(p.ramGb)} GB RAM</span>`);

    const u = p.usage || {};
    const usageHtml = `
        <div class="usage">
            <span class="usage-item"><b>${u.usersConnected || 0}</b> connected</span>
            <span class="dotsmall">·</span>
            <span class="usage-item">${esc(idleText(u.idleSec))}</span>
        </div>`;

    // Serving banner — prominent, right under the IP: category icon + workflow name.
    const wf = p.activeWorkflow || {};
    const servingBanner = isServing ? `
        <div class="serving-banner">
            <span class="wf-icon" title="${esc(wf.category || 'workflow')}">${catIconSvg(wf.category)}</span>
            <div class="serving-text">
                <div class="wf-label">Now serving</div>
                <div class="wf-name">${esc(wf.name || 'a workflow')}</div>
            </div>
        </div>` : '';

    // Lower block: description + queue + schedule (serving) or standby note.
    let workHtml = '';
    if (isServing) {
        const jobs = p.jobs || {};
        const parts = [];
        if (jobs.running) parts.push(jobRow(jobs.running, true));
        for (const j of (jobs.scheduled || [])) parts.push(jobRow(j, false));
        workHtml = `
            ${wf.description ? `<div class="wf-desc">${esc(wf.description)}</div>` : ''}
            <div class="jobs">
                <div class="jobs-label">Queue${jobs.scheduled && jobs.scheduled.length ? ` · ${jobs.scheduled.length} waiting` : ''}</div>
                ${parts.length ? parts.join('') : '<div class="no-jobs">Nothing queued</div>'}
            </div>
            <button class="btn" data-url="${esc(url)}" ${url ? '' : 'disabled'}>Schedule a job ↗</button>`;
    } else {
        workHtml = `<div class="standby">${isAdmin ? 'Not serving a workflow right now.' : 'Ready — no workflow active.'}</div>`;
    }

    const sourceTag = p._source === 'added' ? ' · added by IP'
        : p._source === 'scan' ? ' · found by search' : '';

    const copyBtn = adminUrl
        ? `<button class="copy-btn" data-copy="${esc(adminUrl)}" title="Copy admin panel link">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
           </button>` : '';

    return `
        <div class="card ${kind === 'stale' ? 'stale' : ''}${isSelf ? ' self' : ''}">
            <div class="card-head">
                <div class="head-main">
                    <div class="machine-name">${esc(p.name || 'Unknown machine')}${isSelf ? '<span class="self-tag">This machine</span>' : ''}</div>
                    <div class="machine-ip">${esc((p.ips || []).join(', ') || '—')}${copyBtn}</div>
                </div>
                <span class="dot ${kind}" title="${esc(stateLabel(p, kind))}"></span>
            </div>

            ${servingBanner}

            ${hw.length ? `<div class="hw">${hw.join('')}</div>` : ''}

            <div class="state-line ${kind}">${esc(stateLabel(p, kind))}</div>
            ${usageHtml}

            ${workHtml}

            <div class="footer">Updated ${esc(ago(p._ageMs || 0))}${esc(sourceTag)}</div>
        </div>`;
}

function render(data) {
    const peers = (data.peers || []).slice().sort((a, b) => {
        const d = ORDER[classify(a)] - ORDER[classify(b)];
        return d !== 0 ? d : String(a.name || '').localeCompare(String(b.name || ''));
    });

    countEl.textContent = `${peers.length} machine${peers.length === 1 ? '' : 's'}`;
    subtitleEl.textContent = peers.length ? 'Machines on your network' : 'Looking for machines…';

    if (data.socketError) {
        bannerEl.textContent = `Network problem: ${data.socketError}`;
        bannerEl.classList.remove('hidden');
    } else {
        bannerEl.classList.add('hidden');
    }

    emptyEl.style.display = peers.length ? 'none' : 'block';
    const selfIps = data.selfIps || [];
    appEl.innerHTML = peers.map(p => cardHtml(p, selfIps)).join('');
    for (const btn of appEl.querySelectorAll('.btn[data-url]')) {
        const url = btn.getAttribute('data-url');
        if (url) btn.addEventListener('click', () => window.fleet.openUrl(url));
    }
    for (const btn of appEl.querySelectorAll('.copy-btn[data-copy]')) {
        btn.addEventListener('click', () => {
            window.fleet.copyText(btn.getAttribute('data-copy'));
            showToast('Admin panel link copied');
        });
    }

    if (data.staticPeers) renderStaticChips(data.staticPeers);
    if (data.scan) renderScan(data.scan);
}

function renderScan(scan) {
    if (autoScanChk && document.activeElement !== autoScanChk) autoScanChk.checked = !!scan.enabled;
    if (!scan.enabled) {
        scanStatusEl.textContent = 'automatic search is off';
    } else if (scan.scanning) {
        const pct = scan.total ? ` (${scan.checked}/${scan.total})` : '';
        scanStatusEl.textContent = `searching your network…${pct}`;
    } else {
        scanStatusEl.textContent = scan.discoveredCount
            ? `${scan.discoveredCount} found · checks ${scan.candidateCount} addresses`
            : `no machines found yet · checks ${scan.candidateCount} addresses`;
    }
    if (rescanBtn) rescanBtn.disabled = !scan.enabled || scan.scanning;

    // Populate the range editor (don't clobber a field the user is editing).
    const r = scan.range;
    if (r) {
        const set = (el, v) => { if (el && document.activeElement !== el) el.value = v; };
        set(rangeBase, r.base);
        set(rangeT0, r.third[0]); set(rangeT1, r.third[1]);
        set(rangeF0, r.fourth[0]); set(rangeF1, r.fourth[1]);
        for (const el of [rangeBase, rangeT0, rangeT1, rangeF0, rangeF1, rangeApply]) if (el) el.disabled = !scan.enabled;
    }
}

function liveHostSet(peers) {
    const s = new Set();
    for (const p of peers) for (const ip of (p.ips || [])) s.add(ip);
    return s;
}

function renderStaticChips(hosts) {
    const live = liveHostSet(last.peers || []);
    peerChipsEl.innerHTML = (hosts || []).map(h => {
        const ip = String(h).split(':')[0];
        const ok = live.has(ip);
        return `<span class="chip-peer" title="${ok ? 'responding' : 'no response yet'}">
            <span class="dot-mini ${ok ? 'ok' : 'wait'}"></span>${esc(h)}
            <button class="chip-x" data-host="${esc(h)}" title="Remove">×</button>
        </span>`;
    }).join('');
    for (const x of peerChipsEl.querySelectorAll('.chip-x')) {
        x.addEventListener('click', () => window.fleet.removeStaticPeer(x.getAttribute('data-host')));
    }
}

addPeerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = peerInput.value.trim();
    if (v) { window.fleet.addStaticPeer(v); peerInput.value = ''; }
});
settingsBtn.addEventListener('click', () => controlsEl.classList.toggle('hidden'));
autoScanChk.addEventListener('change', () => window.fleet.setAutoScan(autoScanChk.checked));
rescanBtn.addEventListener('click', () => window.fleet.rescan());
rangeApply.addEventListener('click', () => {
    window.fleet.setScanRange({
        base: rangeBase.value.trim(),
        third: [Number(rangeT0.value), Number(rangeT1.value)],
        fourth: [Number(rangeF0.value), Number(rangeF1.value)]
    });
});

// Keep the latest payload so we can tick the "updated / running" clocks between pushes.
let last = { peers: [], staticPeers: [], scan: null };
window.fleet.onPeers((d) => { last = d; render(d); });
setInterval(() => render(last), 1000);

window.fleet.getStaticPeers().then(renderStaticChips);
