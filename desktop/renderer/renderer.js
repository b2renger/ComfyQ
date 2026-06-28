// ComfyQ Fleet Monitor — renderer.
// Receives peer snapshots over the `fleet` bridge and renders one card per
// machine. No inline handlers (CSP) — listeners are attached after render.

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
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ago(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
}

function classify(p) {
    if (p._stale) return 'stale';
    const serving = p.mode === 'student' && p.comfy && p.comfy.running && p.activeWorkflow;
    if (serving) return 'serving';
    if (p.comfy && p.comfy.running) return 'backend';
    return 'idle';
}

const ORDER = { serving: 0, backend: 1, idle: 2, stale: 3 };

function jobRow(j, running) {
    const time = running
        ? (j.startedAt ? `running ${mmss(Date.now() - j.startedAt)}` : 'running')
        : clock(j.scheduledAt);
    return `
        <div class="job${running ? ' running' : ''}">
            <div class="job-top">
                <span class="job-user">${esc(j.user || 'unknown')}</span>
                <span class="job-time">${esc(time)}</span>
            </div>
            <div class="job-prompt">${esc(j.prompt || '(no prompt)')}</div>
        </div>`;
}

function cardHtml(p) {
    const kind = classify(p);
    const ip = (p.ips && p.ips[0]) || '';
    const uiPort = p.uiPort || 5173;
    const url = ip ? `http://${ip}:${uiPort}` : '';

    const hw = [];
    if (p.gpu) hw.push(`<span class="chip">${esc(p.gpu)}${p.vramGb ? ` · ${p.vramGb}GB VRAM` : ''}</span>`);
    if (p.ramGb) hw.push(`<span class="chip">${esc(p.ramGb)}GB RAM</span>`);

    const comfyRunning = !!(p.comfy && p.comfy.running);
    const comfyText = comfyRunning
        ? (p.comfy.external ? 'running (external)' : 'running')
        : 'stopped';
    const serving = p.activeWorkflow ? esc(p.activeWorkflow.name) : 'none';

    let jobsHtml = '';
    if (p.mode === 'student' && p.activeWorkflow) {
        const jobs = p.jobs || {};
        const parts = [];
        if (jobs.running) parts.push(jobRow(jobs.running, true));
        for (const j of (jobs.scheduled || [])) parts.push(jobRow(j, false));
        jobsHtml = `
            <div class="jobs">
                <h4>Planned jobs${jobs.scheduled && jobs.scheduled.length ? ` (${jobs.scheduled.length})` : ''}</h4>
                ${parts.length ? parts.join('') : '<div class="no-jobs">No planned jobs</div>'}
            </div>`;
    }

    return `
        <div class="card ${kind === 'stale' ? 'stale' : ''}">
            <div class="card-head">
                <div>
                    <div class="machine-name">${esc(p.name || 'Unknown')}</div>
                    <div class="machine-ip">${esc((p.ips || []).join(', ') || '—')}</div>
                </div>
                <span class="dot ${kind}" title="${kind}"></span>
            </div>

            ${hw.length ? `<div class="hw">${hw.join('')}</div>` : ''}

            <div class="status-rows">
                <div class="row"><span class="k">ComfyQ panel</span><span class="v on">running · ${esc(p.mode || '?')} mode</span></div>
                <div class="row"><span class="k">ComfyUI backend</span><span class="v ${comfyRunning ? 'on' : 'off'}">${esc(comfyText)}</span></div>
                <div class="row"><span class="k">Serving</span><span class="v ${p.activeWorkflow ? 'on' : 'off'}">${serving}</span></div>
            </div>

            ${jobsHtml}

            <button class="btn" data-url="${esc(url)}" ${url ? '' : 'disabled'}>Schedule a job ↗</button>
            <div class="footer">Last seen ${esc(ago(p._ageMs || 0))}${p._source === 'poll' ? ' · via IP' : ''}</div>
        </div>`;
}

function render(data) {
    const peers = (data.peers || []).slice().sort((a, b) => {
        const d = ORDER[classify(a)] - ORDER[classify(b)];
        return d !== 0 ? d : String(a.name || '').localeCompare(String(b.name || ''));
    });

    countEl.textContent = `${peers.length} machine${peers.length === 1 ? '' : 's'}`;
    subtitleEl.textContent = peers.length
        ? `Listening on ${data.group}:${data.port}`
        : 'Listening for machines on the LAN…';

    if (data.socketError) {
        bannerEl.textContent = `Network listener problem: ${data.socketError}`;
        bannerEl.classList.remove('hidden');
    } else {
        bannerEl.classList.add('hidden');
    }

    emptyEl.style.display = peers.length ? 'none' : 'block';
    appEl.innerHTML = peers.map(cardHtml).join('');

    for (const btn of appEl.querySelectorAll('.btn[data-url]')) {
        const url = btn.getAttribute('data-url');
        if (!url) continue;
        btn.addEventListener('click', () => window.fleet.openUrl(url));
    }

    if (data.staticPeers) renderStaticChips(data.staticPeers);
    if (data.scan) renderScanStatus(data.scan);
}

function renderScanStatus(scan) {
    if (autoScanChk && document.activeElement !== autoScanChk) autoScanChk.checked = !!scan.enabled;
    const cidr = (scan.cidrs && scan.cidrs[0]) || 'local subnet';
    if (!scan.enabled) {
        scanStatusEl.textContent = 'auto-discovery off';
    } else if (scan.scanning) {
        scanStatusEl.textContent = `scanning ${cidr} (${scan.candidateCount} hosts)…`;
    } else {
        scanStatusEl.textContent = `${cidr} · ${scan.discoveredCount} found`;
    }
    if (rescanBtn) rescanBtn.disabled = !scan.enabled || scan.scanning;
}

// Which configured static hosts currently resolve to a live card (so we can
// show reachable vs. waiting).
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
        return `<span class="chip-peer ${ok ? 'ok' : 'wait'}" title="${ok ? 'reachable' : 'waiting for response'}">
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

autoScanChk.addEventListener('change', () => window.fleet.setAutoScan(autoScanChk.checked));
rescanBtn.addEventListener('click', () => window.fleet.rescan());

// Keep the latest payload so we can re-render between beacons to tick the
// "last seen" / running-elapsed clocks.
let last = { peers: [], staticPeers: [], group: '', port: '' };
window.fleet.onPeers((d) => { last = d; render(d); });
setInterval(() => render(last), 1000);

// Seed the chips immediately (before the first peer push).
window.fleet.getStaticPeers().then(renderStaticChips);
