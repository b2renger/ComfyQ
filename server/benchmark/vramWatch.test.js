/**
 * The VRAM watcher's baseline, which is what decides whether two workflows can
 * be served side by side on one card.
 *
 * Regression: calibrating the FastVideo i2v straight after its t2v sibling
 * reported 8.79 GB against a 31.14 GB card peak — ComfyUI answers /free with a
 * 200 while the previous run's weights are still resident, so the first sample
 * was taken against a card that still held ~22 GB. Under-reporting is the
 * direction that admits a lane which does not fit, so the floor is now the
 * LOWEST reading seen, not the first, and calibration waits for the card to
 * settle before the timed run.
 */
const assert = require('assert');
const { BenchmarkService } = require('./benchmarkService');

const GB = 1024 ** 3;
let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
async function atest(name, fn) {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// A worker whose /system_stats walks a scripted list of card readings (GB).
// The last value repeats once the script runs out.
function stubService(cardGb, torchGb = []) {
    let i = 0;
    const worker = {
        rest: {
            ping: async () => {
                const card = cardGb[Math.min(i, cardGb.length - 1)];
                const mine = torchGb[Math.min(i, torchGb.length - 1)] || 0;
                i++;
                return {
                    devices: [{
                        type: 'cuda',
                        vram_total: 32 * GB, vram_free: (32 - card) * GB,
                        torch_vram_total: 32 * GB, torch_vram_free: (32 - mine) * GB,
                    }],
                };
            },
        },
    };
    const svc = new BenchmarkService({ worker, registry: null, comfyConfig: {}, assetsDir: '' });
    return { svc, reads: () => i };
}

const run = async () => {
    console.log('vramWatch:');

    await atest('a baseline left dirty by the previous run does not eat the footprint', async () => {
        // 22 GB still held at t0, released to 2 GB, then this run climbs to 31.
        const { svc } = stubService([22, 2, 12, 31, 31]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.ok(out.peakGb >= 28, `expected ~29 GB of growth, got ${out.peakGb}`);
        assert.strictEqual(out.cardPeakGb, 31);
    });

    await atest('a clean card measures growth from its own floor', async () => {
        const { svc } = stubService([2, 10, 18, 18]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.strictEqual(out.peakGb, 16, `2 GB floor to an 18 GB peak is 16, got ${out.peakGb}`);
    });

    await atest('torch wins when it holds more than the card grew', async () => {
        // A second lane frees while we run, so the card barely grows — but the
        // torch allocator says plainly what this process took.
        const { svc } = stubService([20, 20, 21], [0, 9, 9]);
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        await new Promise(r => setTimeout(r, 40));
        const out = await w.stop();
        assert.strictEqual(out.peakGb, 9);
        assert.strictEqual(out.torchPeakGb, 9);
    });

    await atest('settle waits for the drop, then returns', async () => {
        const { svc, reads } = stubService([22, 14, 6, 2, 2, 2]);
        const t0 = Date.now();
        await svc._waitForVramSettle({ timeoutMs: 3000, intervalMs: 5, quietMs: 20 });
        assert.ok(Date.now() - t0 < 2500, 'should return well before the timeout');
        assert.ok(reads() >= 4, `should have watched it fall, only ${reads()} reads`);
    });

    await atest('settle gives up on a card that never drops', async () => {
        // A second lane holding a model resident never releases it; waiting for
        // that would hang every calibration on a two-lane machine.
        const { svc } = stubService([18]);
        const t0 = Date.now();
        await svc._waitForVramSettle({ timeoutMs: 2000, intervalMs: 5, quietMs: 20 });
        assert.ok(Date.now() - t0 < 1500, 'should stop waiting once it is quiet');
    });

    await atest('an unreachable ComfyUI does not stall the run', async () => {
        const worker = { rest: { ping: async () => { throw new Error('ECONNREFUSED'); } } };
        const svc = new BenchmarkService({ worker, registry: null, comfyConfig: {}, assetsDir: '' });
        await svc._waitForVramSettle({ timeoutMs: 2000, intervalMs: 5, quietMs: 20 });
        const w = svc._watchVram({ intervalMs: 5, settleMs: 1 });
        const out = await w.stop();
        assert.strictEqual(out.peakGb, null, 'nothing seen means no figure, not 0 GB');
    });

    console.log(`\nvramWatch: all ${passed} checks passed`);
};

run();
