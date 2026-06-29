// Ad-hoc code-sign the macOS .app after electron-builder packs it.
//
// Why: Apple Silicon refuses to run an UNSIGNED binary and reports it as
// "damaged". An ad-hoc signature (codesign --sign -) needs no Apple certificate
// or account and makes the app a valid, runnable binary — macOS then shows the
// gentler "unidentified developer" prompt (which has a no-Terminal GUI bypass:
// right-click → Open, or System Settings → Privacy & Security → Open Anyway)
// instead of the dead-end "damaged".
//
// We do this in afterPack (and disable electron-builder's own signing via
// mac.identity: null) so there is exactly one signing step we fully control,
// rather than depending on electron-builder's version-specific ad-hoc handling.
// The app is still NOT notarized, so the one-time first-launch bypass remains.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;   // macOS only

    const appName = context.packager.appInfo.productFilename;   // "ComfyQ Discovery"
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    console.log(`[afterPack] ad-hoc signing ${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });

    // Print the resulting signature to the CI log so we can confirm it stuck
    // (expect: "Signature=adhoc").
    try { execFileSync('codesign', ['-dvv', appPath], { stdio: 'inherit' }); } catch { /* informational only */ }
};
