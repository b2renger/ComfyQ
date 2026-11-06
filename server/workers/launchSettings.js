// Does a ComfyUI that is already running match the settings ComfyQ would start
// it with now?
//
// ComfyUI outlives ComfyQ (see comfyLauncher.js): a ComfyQ restart, a live
// switch or a lane reopening reuses the ComfyUI already running instead of
// starting another. That saves a cold boot and a model reload, but it also
// means a launch setting no longer applies by itself the way it did when every
// ComfyQ restart respawned ComfyUI. So a reused process is compared with what
// it would be started with now — read from its own argv (/system_stats), the
// only record of what it was really started with.

const path = require('path');
const { PERF_FLAG_KEYS, PERF_FLAG_LABELS, flagsFromArgv } = require('./perfFlags');

// `--listen` with no value means ComfyUI's const "0.0.0.0,::"; absent, it is
// loopback. Only "everyone or not" matters here.
function listensToAll(bind) {
    return String(bind || '').split(',').some(h => h.trim() === '0.0.0.0' || h.trim() === '::');
}

// What a running ComfyUI was started with, from its argv. null when ComfyUI
// does not report one (nothing can be compared, so nothing is called different).
function runningLaunch(argv) {
    if (!Array.isArray(argv) || argv.length === 0) return null;
    const args = argv.map(String);
    let bind = '127.0.0.1';
    const i = args.indexOf('--listen');
    if (i >= 0) bind = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '0.0.0.0,::';
    // argv[0] is main.py; ComfyQ always starts it by absolute path, so its
    // folder is the install it runs from. A relative one says nothing.
    const main = args[0];
    const root = /main\.py$/i.test(main) && path.isAbsolute(main) ? path.dirname(main) : null;
    return { flags: flagsFromArgv(args), bind, root };
}

function samePath(a, b) {
    const norm = p => path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32'
        ? norm(a).toLowerCase() === norm(b).toLowerCase()
        : norm(a) === norm(b);
}

// Every way the running ComfyUI differs from `wanted`
// ({ use_sage_attention, fp16_accumulation, bindHost, rootPath }), each with
// `breaks: true` when keeping it would produce broken output — a perf flag ON
// that this lane runs without saves black images, which is why the old
// blockingFlags check existed. Everything else is a setting that has not
// applied yet: slower, or reachable from the wrong places, not broken.
function launchDrift(wanted, running) {
    if (!running || !wanted) return [];
    const out = [];
    for (const key of PERF_FLAG_KEYS) {
        const want = !!wanted[key];
        const has = !!running.flags?.[key];
        if (want === has) continue;
        const label = PERF_FLAG_LABELS[key];
        out.push({
            key, label, wanted: want, running: has, breaks: has && !want,
            text: has ? `it was started with ${label}, and this lane runs without it`
                : `it was started without ${label}, and this lane runs with it`,
        });
    }
    if (wanted.bindHost) {
        const want = listensToAll(wanted.bindHost);
        const has = listensToAll(running.bind);
        if (want !== has) {
            out.push({
                key: 'lan_access', label: 'LAN access', wanted: want, running: has, breaks: false,
                text: has ? 'it is reachable from the LAN, and the settings keep it on this machine'
                    : 'it is reachable only from this machine, and the settings expose it to the LAN',
            });
        }
    }
    if (wanted.rootPath && running.root && !samePath(wanted.rootPath, running.root)) {
        out.push({
            key: 'root_path', label: 'install', wanted: wanted.rootPath, running: running.root, breaks: false,
            text: `it runs from ${running.root}, and the settings point at ${wanted.rootPath}`,
        });
    }
    return out;
}

module.exports = { runningLaunch, launchDrift, listensToAll };
