// The ComfyUI WebSocket client must never take ComfyQ down while ComfyUI is
// being relaunched.
//
// The crash this pins (found by lanes.integration.js, 2026-11-05): ComfyUI goes
// down for a relaunch → the socket closes → a reconnect is scheduled → the
// worker replaces this client (close() + removeAllListeners()) → the pending
// reconnect fired anyway, hit the dead port, and emitted 'error' with no
// listener, which throws and kills Node.
//
// Run with:  node server/workers/comfyWsClient.test.js

const assert = require('assert');
const { ComfyWsClient } = require('./comfyWsClient');

let fails = 0;
let uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(e));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function test(name, fn) {
    uncaught = [];
    try { await fn(); assert.deepStrictEqual(uncaught.map(e => e.message), [], 'an error escaped'); console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fails++; }
}

// A port nothing listens on: one the OS just handed out and took back. A
// fixed number could belong to some local program, and the test would then
// talk to it.
let DEAD_PORT;
async function deadPort() {
    const net = require('net');
    const srv = net.createServer();
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    await new Promise(r => srv.close(r));
    return port;
}

(async () => {
    DEAD_PORT = await deadPort();
    await test('closed while a reconnect is pending, listeners removed: the reconnect never fires', async () => {
        const c = new ComfyWsClient({ host: '127.0.0.1', port: DEAD_PORT, clientId: 't1' });
        c.on('error', () => {});
        await new Promise(r => c.once('close', r));     // refused → close → reconnect scheduled (1 s)
        const sock = c.ws;
        c.close();
        c.removeAllListeners();                         // what the worker does when it replaces the client
        await wait(1800);
        assert.strictEqual(c.ws, sock, 'a new socket was opened after close()');
    });

    await test('a socket that fails with nobody listening does not throw', async () => {
        const c = new ComfyWsClient({ host: '127.0.0.1', port: DEAD_PORT, clientId: 't2' });
        c.removeAllListeners();                         // the refusal arrives after this
        await wait(600);
        c.close();
    });

    await test('an error IS still reported to a listener', async () => {
        const c = new ComfyWsClient({ host: '127.0.0.1', port: DEAD_PORT, clientId: 't3' });
        const err = await new Promise(r => c.once('error', r));
        assert.match(err.message, /ECONNREFUSED/);
        c.close();
    });

    if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
    console.log('\ncomfyWsClient: all passed');
    process.exit(0);
})();
