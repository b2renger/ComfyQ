const fs = require('fs');
const path = require('path');

// Copies a user-uploaded file from the ComfyQ-managed staging dir into
// ComfyUI/input/ with a namespaced filename so two jobs can't clobber each
// other and so we can clean up later by job id.
//
// Returned record shape: { paramKey, originalName, sourcePath, comfyFilename }
class InputUploader {
    constructor({ comfyInputDir, retentionMinutes = 30 }) {
        this.inputDir = comfyInputDir;
        this.retentionMs = retentionMinutes * 60 * 1000;
        fs.mkdirSync(this.inputDir, { recursive: true });
    }

    namespacedName(jobId, originalName) {
        const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        return `comfyq__${jobId.slice(0, 8)}__${safe}`;
    }

    // Copy one file. `source` may be an absolute path or a buffer.
    copy({ jobId, paramKey, originalName, source }) {
        const dest = path.join(this.inputDir, this.namespacedName(jobId, originalName));
        if (Buffer.isBuffer(source)) {
            fs.writeFileSync(dest, source);
        } else if (typeof source === 'string') {
            fs.copyFileSync(source, dest);
        } else {
            throw new Error('Unsupported input source');
        }
        return {
            paramKey,
            originalName,
            sourcePath: typeof source === 'string' ? source : null,
            comfyFilename: path.basename(dest),
            destPath: dest
        };
    }

    // Best-effort cleanup of files older than retentionMs whose name matches
    // the comfyq__ pattern. Caller decides when (e.g., on timer or after job
    // finalization).
    sweepStale() {
        const now = Date.now();
        let removed = 0;
        try {
            for (const name of fs.readdirSync(this.inputDir)) {
                if (!name.startsWith('comfyq__')) continue;
                const full = path.join(this.inputDir, name);
                try {
                    const st = fs.statSync(full);
                    if (now - st.mtimeMs > this.retentionMs) {
                        fs.unlinkSync(full);
                        removed++;
                    }
                } catch { /* ignore */ }
            }
        } catch { /* dir may not exist yet */ }
        if (removed) console.log(`[InputUploader] Swept ${removed} stale input file(s)`);
        return removed;
    }

    // Forced cleanup for a specific job (used after job reaches a terminal
    // state — the executor calls this when it's safe to delete).
    cleanupJob(jobId) {
        const prefix = `comfyq__${jobId.slice(0, 8)}__`;
        let removed = 0;
        try {
            for (const name of fs.readdirSync(this.inputDir)) {
                if (!name.startsWith(prefix)) continue;
                try { fs.unlinkSync(path.join(this.inputDir, name)); removed++; } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
        return removed;
    }
}

module.exports = { InputUploader };
