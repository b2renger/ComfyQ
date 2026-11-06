// ComfyQ – Discovery: the parts of main.js and renderer.js that read what
// OTHER machines send. Neither file can be required outside Electron, so each
// is loaded into a vm with the Electron / DOM pieces stubbed, and the real
// functions are called.
//
// What this pins (review of 2026-11-05):
//   - a beacon field never reaches the card's HTML unescaped (any LAN host can
//     send a beacon, and the page has no CSP);
//   - on a big local network the Search range and the seeded ranges are still
//     scanned (the local subnet used to fill the 4096-address cap first), and
//     a Search range bigger than the cap never pushes out the machine's own /24;
//   - a probe whose reply is cut off after its headers settles, instead of
//     leaving the sweep "searching" until the app restarts;
//   - two cloned machines sharing one identity: when the one holding the plain
//     id goes quiet its card dims, and the other is not listed twice;
//   - a machine serving several models shows each model's own queue on its
//     card (and an older server's machine-wide queue on every card).
//
// Run with:  node desktop/discovery.test.js

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

let fails = 0;
async function test(name, fn) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// ---- main.js in a vm ---------------------------------------------------------
function loadMain({ ifaces = {}, env = {} } = {}) {
    const noop = () => {};
    const electron = {
        app: { whenReady: () => ({ then: noop }), on: noop, getPath: () => '.', isPackaged: false, getVersion: () => '0.0.0' },
        BrowserWindow: function () {}, ipcMain: { handle: noop }, shell: {}, clipboard: {}
    };
    const fakeOs = { ...require('os'), networkInterfaces: () => ifaces };
    const ctx = vm.createContext({
        require: (m) => (m === 'electron' ? electron : m === 'os' ? fakeOs : require(m)),
        module: { exports: {} }, exports: {},
        __dirname: __dirname, __filename: path.join(__dirname, 'main.js'),
        console, process: { env, platform: process.platform },
        setInterval: noop, setTimeout: noop, clearTimeout: noop
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), ctx, { filename: 'main.js' });
    vm.runInContext('globalThis.__now = 0; Date.now = () => globalThis.__now;', ctx);
    return ctx;
}

// ---- renderer.js in a vm (a DOM where every lookup returns a harmless stub) --
function loadRenderer() {
    const stub = new Proxy(function () {}, {
        get: (_t, k) => (typeof k === 'symbol' ? undefined : stub),
        apply: () => stub,
        set: () => true
    });
    const ctx = vm.createContext({ document: stub, window: stub, localStorage: stub, setInterval: () => {}, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8'), ctx, { filename: 'renderer.js' });
    return ctx;
}

(async () => {
    // ------------------------------------------------------------------ renderer
    const r = loadRenderer();
    const serving = (over) => ({
        v: 1, id: 'm1', name: 'Rig', ips: ['10.10.17.9'], gpu: 'RTX 5090', vramGb: 32, ramGb: 64,
        mode: 'student', comfy: { running: true }, usage: { usersConnected: 3, idleSec: 5 },
        servedWorkflows: [{ id: 'wf', name: 'WF' }],
        jobs: { running: { id: 'j1', user: 'ana', prompt: 'p', startedAt: 1_700_000_000_000 }, scheduled: [] },
        _key: 'm1', _lastSeen: 0, _ageMs: 0, ...over
    });

    await test('renderer: a hostile beacon cannot put markup into a card', () => {
        const evil = '"><img src=x onerror=alert(1)>';
        const p = serving({
            vramGb: evil, usage: { usersConnected: evil, idleSec: evil },
            jobs: { running: { id: 'j', user: evil, prompt: evil, startedAt: evil }, scheduled: [{ id: 's', user: evil, prompt: evil, scheduledAt: evil }] }
        });
        const html = r.cardHtml(p, [], p.servedWorkflows[0]);
        assert.ok(!/<img/i.test(html), `raw markup in the card: ${html.match(/.{0,40}<img.{0,40}/i)}`);
        assert.ok(!/data-start=/.test(html), 'a non-numeric start time still got a live timer');
    });

    await test('renderer: normal values still render (GPU memory, users, running timer)', () => {
        const p = serving({});
        const html = r.cardHtml(p, [], p.servedWorkflows[0]);
        assert.ok(html.includes('RTX 5090 · 32 GB'), 'GPU memory missing');
        assert.ok(html.includes('<b>3</b> connected'), 'connected count missing');
        assert.ok(html.includes('data-start="1700000000000"'), 'running timer missing');
    });

    await test('renderer: an id clash points at the fix that changes the id, not at renaming', () => {
        const p = serving({ _idClash: true });
        const html = r.cardHtml(p, [], p.servedWorkflows[0]);
        const title = (html.match(/class="id-clash" title="([^"]*)"/) || [])[1] || '';
        assert.ok(title.includes('delete instance.id from ComfyQ\\config.json'), `tooltip lacks the config fix: ${title}`);
        assert.ok(title.includes('Renaming under Network presence does not change the id'), 'tooltip still implies renaming fixes it');
    });

    // ------------------------------------------------------ one queue per model
    const twoLanes = (jobs) => serving({
        servedWorkflows: [{ id: 'flux', name: 'Flux' }, { id: 'sam', name: 'SAM' }],
        jobs
    });
    const job = (id, user, workflowId, over = {}) => ({ id, user, prompt: `prompt ${id}`, workflowId, scheduledAt: 1_700_000_100_000, ...over });

    await test('renderer: with two models served, each card lists only its own model\'s jobs', () => {
        const p = twoLanes({
            running: job('r1', 'ana', 'flux', { startedAt: 1_700_000_000_000 }),
            runningAll: [job('r1', 'ana', 'flux', { startedAt: 1_700_000_000_000 }), job('r2', 'bob', 'sam', { startedAt: 1_700_000_050_000 })],
            scheduled: [job('s1', 'cleo', 'flux'), job('s2', 'dan', 'sam'), job('s3', 'eve', 'sam')]
        });
        const flux = r.cardHtml(p, [], p.servedWorkflows[0]);
        const sam = r.cardHtml(p, [], p.servedWorkflows[1]);
        assert.ok(flux.includes('ana') && flux.includes('cleo'), 'the Flux card lost its own jobs');
        assert.ok(!flux.includes('bob') && !flux.includes('dan') && !flux.includes('eve'), 'the Flux card shows the SAM queue');
        assert.ok(flux.includes('Queue · 1 waiting'), 'the Flux card counts the other model\'s jobs');
        assert.ok(sam.includes('bob') && sam.includes('dan') && sam.includes('eve'), 'the SAM card lost its own jobs');
        assert.ok(!sam.includes('ana') && !sam.includes('cleo'), 'the SAM card shows the Flux queue');
        assert.ok(sam.includes('data-start="1700000050000"'), 'the SAM card does not show its own running job');
        assert.ok(sam.includes('Queue · 2 waiting'));
    });

    await test('renderer: an older server (no runningAll, no workflowId) keeps the machine-wide queue on every card', () => {
        const p = twoLanes({
            running: { id: 'r1', user: 'ana', prompt: 'p', startedAt: 1_700_000_000_000 },
            scheduled: [{ id: 's1', user: 'cleo', prompt: 'q', scheduledAt: 1_700_000_100_000 }]
        });
        for (const wf of p.servedWorkflows) {
            const html = r.cardHtml(p, [], wf);
            assert.ok(html.includes('ana') && html.includes('cleo') && html.includes('Queue · 1 waiting'), `card ${wf.id} lost the queue`);
        }
    });

    await test('renderer: a job starting on one model rebuilds the cards (signature changes)', () => {
        const before = twoLanes({ running: null, runningAll: [], scheduled: [job('s2', 'dan', 'sam')] });
        const after = twoLanes({ running: job('s2', 'dan', 'sam', { startedAt: 1 }), runningAll: [job('s2', 'dan', 'sam', { startedAt: 1 })], scheduled: [] });
        assert.notStrictEqual(r.cardsSignature([before], []), r.cardsSignature([after], []));
        const moved = twoLanes({ running: null, runningAll: [], scheduled: [job('s2', 'dan', 'flux')] });
        assert.notStrictEqual(r.cardsSignature([before], []), r.cardsSignature([moved], []), 'a job moving to the other model does not rebuild');
    });

    // ------------------------------------------------------------- scan ranges
    await test('scan: on a /16 local network the Search range and seeded ranges are still probed', () => {
        const m = loadMain({
            ifaces: { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '172.20.5.9', netmask: '255.255.0.0' }] },
            env: { COMFYQ_FED_SCAN: '192.168.50.0/24' }
        });
        vm.runInContext("scanRange = { base: '10.10', third: [16, 17], fourth: [1, 254] }", m);
        const ips = m.scanCandidates();
        assert.strictEqual(ips.length, 4096, 'the cap no longer applies');
        for (const ip of ['10.10.16.5', '10.10.17.50', '10.10.14.1', '10.10.18.254', '192.168.50.20']) {
            assert.ok(ips.includes(ip), `${ip} was dropped`);
        }
        assert.ok(ips.includes('172.20.0.1'), 'the local subnet is no longer scanned at all');
        assert.ok(ips.includes('172.20.5.1') && ips.includes('172.20.5.254'), "the machine's own /24 was cut");
        assert.ok(!ips.includes('172.20.5.9'), 'this machine probes itself');
    });

    await test("scan: a Search range bigger than the cap does not push out the machine's own /24", () => {
        const m = loadMain({
            ifaces: { 'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.50.20', netmask: '255.255.255.0' }] }
        });
        vm.runInContext("scanRange = { base: '10.10', third: [0, 255], fourth: [1, 254] }", m);
        const ips = m.scanCandidates();
        assert.strictEqual(ips.length, 4096, 'the cap no longer applies');
        for (const ip of ['192.168.50.1', '192.168.50.19', '192.168.50.21', '192.168.50.254']) {
            assert.ok(ips.includes(ip), `${ip} (own /24) was dropped`);
        }
        assert.ok(!ips.includes('192.168.50.20'), 'this machine probes itself');
        assert.ok(ips.includes('10.10.0.1'), 'the Search range is no longer scanned');
    });

    await test('scan: a subnet smaller than a /24 is not widened to the whole /24', () => {
        const m = loadMain({
            ifaces: { 'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.1.130', netmask: '255.255.255.128' }] }
        });
        const ips = m.scanCandidates();
        assert.ok(ips.includes('192.168.1.200'), 'own subnet missing');
        assert.ok(!ips.includes('192.168.1.5'), 'probes outside its own /25');
    });

    // ---------------------------------------------------------------- fetchSelf
    const server = http.createServer((req, res) => {
        const mode = server.mode;
        if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ v: 1, id: 'x' })); }
        else if (mode === 'notfound') { res.writeHead(404); res.end('no'); }
        else if (mode === 'cut') { res.writeHead(200); res.write('{"v":1,'); setTimeout(() => req.socket.destroy(), 50); }
        else if (mode === 'stall') { res.writeHead(200); res.write('{"v":'); /* then nothing */ }
        else if (mode === 'huge') { res.writeHead(200); const chunk = 'x'.repeat(64 * 1024); for (let i = 0; i < 20; i++) res.write(chunk); }
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const m = loadMain();
    const probe = (mode, timeoutMs = 300) => {
        server.mode = mode;
        return Promise.race([
            m.fetchSelf('127.0.0.1', port, timeoutMs),
            new Promise(ok => setTimeout(() => ok('NEVER SETTLED'), 3000))
        ]);
    };

    await test('fetchSelf: a normal reply is parsed (twice, so a kept-alive socket is reused)', async () => {
        assert.strictEqual((await probe('ok')).id, 'x');
        assert.strictEqual((await probe('ok')).id, 'x');
    });
    await test('fetchSelf: a non-200 reply gives null', async () => {
        assert.strictEqual(await probe('notfound'), null);
    });
    await test('fetchSelf: a reply cut off after its headers settles to null', async () => {
        assert.strictEqual(await probe('cut'), null);
    });
    await test('fetchSelf: a reply that stalls after its headers settles to null', async () => {
        assert.strictEqual(await probe('stall'), null);
    });
    await test('fetchSelf: a reply over 1 MB settles to null', async () => {
        assert.strictEqual(await probe('huge'), null);
    });
    server.closeAllConnections();
    server.close();

    // ------------------------------------------------------- cloned identities
    const k = loadMain();
    const peers = vm.runInContext('peers', k);
    const at = (ms) => vm.runInContext(`globalThis.__now = ${ms}`, k);
    const beacon = (id, ip) => k.mergeSnap({ v: 1, id, ips: [ip] }, ip, 'beacon');

    await test('clones: when the holder of the plain id goes quiet, its card dims and the other is listed once', () => {
        at(0); beacon('X', '10.10.17.1');                    // clone A
        at(1000); beacon('X', '10.10.17.2');                 // clone B → its own card
        for (let t = 6000; t <= 46000; t += 5000) { at(t); beacon('X', '10.10.17.2'); }   // A silent 46 s
        assert.deepStrictEqual([...peers.keys()].sort(), ['X', 'X#10.10.17.2']);
        assert.deepStrictEqual([...peers.get('X').snap.ips], ['10.10.17.1'], "A's card was overwritten by B");
        assert.strictEqual(peers.get('X').lastSeen, 0, "A's card does not show it went quiet");
        assert.strictEqual(peers.get('X#10.10.17.2').lastSeen, 46000);
    });
    await test('clones: once the quiet card is dropped, the other keeps its own card (no duplicate)', () => {
        peers.delete('X');                                   // A expired (DROP_MS)
        at(50000); beacon('X', '10.10.17.2');
        assert.deepStrictEqual([...peers.keys()], ['X#10.10.17.2']);
    });
    await test('identity: a machine that changed address after going quiet takes its slot back', () => {
        peers.clear();
        at(0); beacon('Y', '10.0.0.1');
        at(40000); beacon('Y', '10.0.0.5');                  // > STALE_MS later, new DHCP address
        assert.deepStrictEqual([...peers.keys()], ['Y']);
        assert.deepStrictEqual([...peers.get('Y').snap.ips], ['10.0.0.5']);
    });
    await test('identity: a machine with no id is keyed by its address', () => {
        peers.clear();
        k.mergeSnap({ v: 1, ips: ['10.0.0.7'] }, '10.0.0.7', 'scan');
        assert.deepStrictEqual([...peers.keys()], ['ip:10.0.0.7']);
    });

    console.log(fails ? `\n${fails} failed` : '\nall passed');
    process.exit(fails ? 1 : 0);
})();
