// Installing a node pack: a clone that fails must not leave a pack-shaped folder.
// (node server/models/nodePackInstaller.test.js)
//
// ★ The case this exists for: a large pack on a slow workshop link hits the
// 10-minute clone timeout. On Windows the kill is TerminateProcess, so git never
// cleans up after itself, and what is left is custom_nodes/<pack> WITH a .git
// and half a tree. The old cleanup skipped any folder holding a .git — i.e. it
// skipped exactly the folder it existed for — so the half clone listed as an
// installed pack and a second install refused with "already exists".
//
// git itself is stubbed: what matters here is what the installer does with the
// folder a failed clone leaves, and that needs no network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { NodePackInstaller } = require('./nodePackInstaller');

const ok = [];
const check = (label, cond) => { assert.ok(cond, label); ok.push(label); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-packs-'));
const comfy = path.join(root, 'ComfyUI');
fs.mkdirSync(path.join(comfy, 'custom_nodes'), { recursive: true });

/** An installer whose `git clone` does whatever `fake` says. */
function installerWith(fake) {
    const inst = new NodePackInstaller({ config: () => ({ comfy_ui: { root_path: comfy } }) });
    inst._run = async (cmd, args, { job }) => fake(job);
    return inst;
}

async function settle(inst, folder) {
    for (let i = 0; i < 100; i++) {
        const j = inst.list().find(x => x.folder === folder);
        if (j && j.status !== 'cloning') return j;
        await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`${folder} never left 'cloning'`);
}

(async () => {
    // 1. ★ the timed-out clone: .git present, a partial tree, a non-zero exit
    const half = installerWith((job) => {
        fs.mkdirSync(path.join(job.dest, '.git', 'objects'), { recursive: true });
        fs.writeFileSync(path.join(job.dest, 'half_written.py'), 'x');
        job.output.push('timed out after 10 min');
        return 1;
    });
    const url = 'https://github.com/someone/ComfyUI-HalfClone';
    const dest = path.join(comfy, 'custom_nodes', 'ComfyUI-HalfClone');
    check('the install starts', (await half.install(url)).ok === true);
    let job = await settle(half, 'ComfyUI-HalfClone');
    check('a failed clone is reported as failed', job.status === 'failed');
    check('★ the half clone is removed even though it holds a .git', !fs.existsSync(dest));
    check('...and the output says so', job.output.some(l => /removed the incomplete folder/.test(l)));
    // The symptom the owner would have met: "already exists — nothing was touched".
    const again = await installerWith(() => 1).install(url);
    check('so installing again is not refused as "already exists"', again.ok === true);
    await new Promise(r => setTimeout(r, 100));

    // 2. git refused because something ELSE took the path — that folder is not ours
    const theirs = path.join(comfy, 'custom_nodes', 'ComfyUI-TakenMeanwhile');
    const raced = installerWith((job) => {
        fs.mkdirSync(path.join(theirs, '.git'), { recursive: true });
        fs.writeFileSync(path.join(theirs, 'nodes.py'), 'somebody else\'s work');
        job.output.push(`fatal: destination path '${job.dest}' already exists and is not an empty directory.`);
        return 128;
    });
    await raced.install('https://github.com/someone/ComfyUI-TakenMeanwhile');
    job = await settle(raced, 'ComfyUI-TakenMeanwhile');
    check('a clone git refused over an occupied path fails', job.status === 'failed');
    check('★ ...and the folder it did not create is left alone',
        fs.existsSync(path.join(theirs, 'nodes.py')));

    // 3. a clone that works is kept, and asks for a restart
    const good = installerWith((job) => {
        fs.mkdirSync(path.join(job.dest, '.git'), { recursive: true });
        fs.writeFileSync(path.join(job.dest, '__init__.py'), '');
        return 0;
    });
    await good.install('https://github.com/someone/ComfyUI-Good');
    job = await settle(good, 'ComfyUI-Good');
    check('a successful clone is kept', job.status === 'cloned'
        && fs.existsSync(path.join(comfy, 'custom_nodes', 'ComfyUI-Good', '__init__.py')));
    check('...and asks for a ComfyUI restart', job.needsRestart === true);

    // 4. an existing folder is never cloned over
    const existing = await good.install('https://github.com/someone/ComfyUI-Good');
    check('installing over an existing folder is refused', existing.ok === false
        && /already exists/.test(existing.error));

    // 5. ★ pip takes a pack NAME from custom_nodes, never a path. A
    //    requirements.txt one level up is what '..' would reach; with python
    //    and pip stubbed, the old code ran `pip install -r` on it.
    fs.writeFileSync(path.join(comfy, 'requirements.txt'), 'numpy\n');
    fs.writeFileSync(path.join(comfy, 'custom_nodes', 'ComfyUI-Good', 'requirements.txt'), 'tqdm\n');
    const pipCalls = [];
    const piper = installerWith(() => 0);
    piper._python = () => path.join(comfy, 'python.exe');
    piper._run = async (cmd, args) => { pipCalls.push(args.join(' ')); return 0; };
    for (const bad of ['..', '../ComfyUI-Good', '..\\ComfyUI-Good', undefined, null, {}, '']) {
        const r = await piper.pipInstall(bad, true);
        check(`pip refuses ${JSON.stringify(bad) ?? 'undefined'}`, r.ok === false && /not installed/.test(r.error));
    }
    check('★ ...and never runs pip for any of them', pipCalls.length === 0);
    const real = await piper.pipInstall('ComfyUI-Good', true);
    await new Promise(r => setTimeout(r, 50));
    check('a pack that is on disk still gets its pip run', real.ok === true
        && pipCalls.length === 1 && pipCalls[0].includes(path.join('ComfyUI-Good', 'requirements.txt')));

    fs.rmSync(root, { recursive: true, force: true });
    console.log(`nodePackInstaller: all ${ok.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
