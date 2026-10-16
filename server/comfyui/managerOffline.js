const fs = require('fs');
const path = require('path');

// Keep ComfyUI-Manager off the internet when ComfyQ starts a ComfyUI.
//
// At every start Manager fetches the registry and five JSON lists from github
// (custom-node-list, extension-node-map, model-list, alter-list, github-stats).
// On a workshop LAN that cannot reach the internet each fetch waits for its
// timeout and logs a "network error, switching to local mode" — and ComfyQ needs
// none of it: the node-pack check reads extension-node-map.json from disk, and
// updates go through git from the Maintenance tab.
//
// Manager has no command-line flag or environment variable for this. It reads
// `network_mode` (public | private | offline) from
// <user-directory>/__manager/config.ini, so that file is what has to say offline.
// Only that one line is touched; every other setting is kept as written.

function managerConfigPath(userDir) {
    return path.join(userDir, '__manager', 'config.ini');
}

/**
 * Make sure Manager will start offline for this user directory.
 * @returns {'already'|'changed'|'created'}
 */
function setManagerOffline(userDir) {
    const file = managerConfigPath(userDir);
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }

    if (text === null) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '[default]\nnetwork_mode = offline\n');
        return 'created';
    }

    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let section = null;
    let defaultAt = -1;
    let found = false;
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
        const sec = /^\s*\[([^\]]+)\]\s*$/.exec(lines[i]);
        if (sec) { section = sec[1].trim(); if (section === 'default') defaultAt = i; continue; }
        if (section !== 'default') continue;
        const kv = /^(\s*network_mode\s*[=:]\s*)(.*?)\s*$/i.exec(lines[i]);
        if (!kv) continue;
        found = true;
        if (kv[2].toLowerCase() !== 'offline') { lines[i] = `${kv[1]}offline`; changed = true; }
    }
    if (!found) {
        if (defaultAt === -1) lines.unshift('[default]', 'network_mode = offline');
        else lines.splice(defaultAt + 1, 0, 'network_mode = offline');
        changed = true;
    }
    if (!changed) return 'already';
    fs.writeFileSync(file, lines.join(eol));
    return 'changed';
}

module.exports = { setManagerOffline, managerConfigPath };
