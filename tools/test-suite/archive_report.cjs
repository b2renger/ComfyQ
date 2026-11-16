/**
 * Keep a test-suite report in the repo, without the media it points to.
 *
 *   node tools/test-suite/archive_report.cjs [report.json ...]
 *
 * With no argument it archives the published library report
 * (server/data/library-sweep-latest.json) and every speciality report
 * (server/data/specialities/<key>/library-sweep-latest.json). Each becomes
 * tools/test-suite/results/<date it finished>-<suite>.json: every run's settings,
 * seeds, inputs, timings, VRAM and output sizes, a dated record to compare a
 * later run with (after a ComfyUI update, say).
 *
 * The pictures, videos and 3D files are NOT copied (owner, 2026-11-16: "don't
 * push the results, only the reports"): about a gigabyte per full run, which
 * git would keep forever, and they already travel on the cloned drive.
 *
 * ★ Paths are made portable, because the drive letter changes between machines:
 * the ComfyUI output, input and temp folders become output/, input/, temp/, the
 * assets folder assets/, the repo itself a repo-relative path; any other absolute
 * path loses its drive letter. If a drive letter is still left anywhere after
 * that, nothing is written.
 *
 * It refuses to overwrite an archive, and refuses every option: it has none, and
 * a tool that writes by default must not read `--help` as a file name.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'results');
const DRIVE_RX = /\b[A-Za-z]:[\\/]/;

/** The folders a report's paths live under, longest first, each with the label it becomes. */
function rootsFrom(config) {
    const comfy = config.comfy_ui?.root_path || '';
    const roots = [
        [config.comfy_ui?.output_dir || (comfy && path.join(comfy, 'output')), 'output'],
        [comfy && path.join(comfy, 'input'), 'input'],
        [comfy && path.join(comfy, 'temp'), 'temp'],
        [comfy, 'comfyui'],
        [config.assets?.dir, 'assets'],
        [REPO, '.'],
    ].filter(([dir]) => dir);
    return roots.sort((a, b) => b[0].length - a[0].length);
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One string with every known root replaced by its label, and any other drive letter dropped. */
function portable(s, roots) {
    let out = s;
    for (const [dir, label] of roots) {
        // Either slash, any case: Windows paths are spelt every way in a report.
        const rx = new RegExp(escapeRx(path.resolve(dir)).replace(/\\\\/g, '[\\\\/]') + '(?=[\\\\/]|$)', 'gi');
        out = out.replace(rx, label);
    }
    // Only strings that held a path come here, so their backslashes are separators.
    return out.replace(/\b[A-Za-z]:(?=[\\/])/g, '').replace(/\\/g, '/');
}

/** The report, every string made portable. Pure: returns a new object. */
function archive(report, roots) {
    const walk = (v) => {
        if (typeof v === 'string') return DRIVE_RX.test(v) || roots.some(([d]) => v.toLowerCase().includes(path.resolve(d).toLowerCase())) ? portable(v, roots) : v;
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
    };
    return walk(report);
}

/** Where the archive of this report goes: results/<YYYY-MM-DD>-<suite>.json. */
function archiveName(report, fallbackName) {
    const date = String(report.finishedAt || report.startedAt || '').slice(0, 10) || 'undated';
    const suite = String(report.suite?.name || fallbackName || 'sweep').replace(/[^A-Za-z0-9_-]/g, '-');
    return `${date}-${suite}.json`;
}

function main(argv) {
    const flags = argv.filter(a => a.startsWith('-'));
    if (flags.length) {
        console.error(`Unknown option ${flags.join(', ')}: this tool has none. Nothing was written.`);
        console.error('Usage: node tools/test-suite/archive_report.cjs [report.json ...]');
        return 1;
    }
    const config = JSON.parse(fs.readFileSync(path.join(REPO, 'config.json'), 'utf8'));
    const roots = rootsFrom(config);
    let files = argv;
    if (!files.length) {
        files = [path.join(REPO, 'server', 'data', 'library-sweep-latest.json')];
        const spec = path.join(REPO, 'server', 'data', 'specialities');
        if (fs.existsSync(spec)) {
            for (const k of fs.readdirSync(spec).sort()) {
                const f = path.join(spec, k, 'library-sweep-latest.json');
                if (fs.existsSync(f)) files.push(f);
            }
        }
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let failed = 0;
    for (const f of files) {
        const report = JSON.parse(fs.readFileSync(f, 'utf8'));
        const out = path.join(OUT_DIR, archiveName(report, path.basename(path.dirname(f))));
        if (fs.existsSync(out)) { console.log(`exists, kept as it is: ${path.relative(REPO, out)}`); continue; }
        const text = JSON.stringify(archive(report, roots), null, 1) + '\n';
        const left = text.match(new RegExp(DRIVE_RX.source, 'g'));
        if (left) { console.error(`REFUSED ${path.relative(REPO, f)}: ${left.length} absolute path(s) left after rewriting. Nothing written.`); failed++; continue; }
        fs.writeFileSync(out, text);
        const runs = (report.results || []).length;
        console.log(`wrote ${path.relative(REPO, out)}: ${runs} runs, ${(text.length / 1024).toFixed(0)} KB`);
    }
    return failed ? 1 : 0;
}

module.exports = { archive, archiveName, rootsFrom, portable };
if (require.main === module) process.exit(main(process.argv.slice(2)));
