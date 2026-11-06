// Which parameters are random seeds. The booking form rolls a fresh value for
// each one and gives it a re-roll button; the result panel shows them on their
// own "Seed" line.
//
// The server's rule (server/benchmark/benchmarkService.js isSeedParam), copied
// because the client cannot import server code. Both are tested against the
// same list, server/benchmark/seedParam.fixture.json, so they cannot drift.
//
// `seed` must be the LAST word of the key, followed only by node-id numbers:
// `seed`, `seed_7`, `ksampler_seed_3`, `randomnoise_noise_seed_75_73`. Or the
// field it writes is a seed: `seed`, `noise_seed`, `sampling_mode.seed`.
// ⚠ Never a bare /seed/ anywhere in the name: SeedVR2's colour-correction key
// (`seedvr2postprocessing_color_correction_method_66_59`) contains it.
//
// The key alone gives the same answer as key + field on every bundle, so a
// caller that only has a job's param keys can call isSeedParam(key).
export const isSeedParam = (key, config) => {
    const k = String(key || '').toLowerCase();
    const f = String(config?.field || '').toLowerCase();
    return /(^|_)seed(_\d+)*$/.test(k) || /(^|[._])seed$/.test(f);
};

// A fresh seed inside the bounds the param declares. Two cards declare
// max 2147483647; a roll over the whole 32-bit range landed above it about half
// the time, the server then ran every one of those at max (clampParamValue),
// and the job recorded a seed that never ran. With no bounds, the range is the
// one the form always used: 0 to 4294967294.
const SEED_CEILING = 4294967294;
export const randomSeed = (config) => {
    const lo = Number.isFinite(config?.min) ? Math.ceil(config.min) : 0;
    const hi = Math.min(Number.isFinite(config?.max) ? Math.floor(config.max) : SEED_CEILING, SEED_CEILING);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
};
