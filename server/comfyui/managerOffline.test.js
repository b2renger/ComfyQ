// managerOffline — only network_mode changes, everything else survives.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setManagerOffline, managerConfigPath } = require('./managerOffline');

let pass = 0;
const ok = (what, cond) => { assert.ok(cond, what); pass++; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'comfyq-mgr-'));

// No config yet (a fresh lane user dir): one is created.
let d = tmp();
ok('a missing config is created', setManagerOffline(d) === 'created');
ok('…and says offline', /network_mode = offline/.test(fs.readFileSync(managerConfigPath(d), 'utf8')));
ok('a second run changes nothing', setManagerOffline(d) === 'already');

// The real shape on this rig: public, CRLF, many other keys.
d = tmp();
fs.mkdirSync(path.join(d, '__manager'));
const orig = '[default]\r\npreview_method = none\r\nsecurity_level = weak\r\nnetwork_mode = public\r\ndb_mode = cache\r\n';
fs.writeFileSync(managerConfigPath(d), orig);
ok('public is switched', setManagerOffline(d) === 'changed');
const after = fs.readFileSync(managerConfigPath(d), 'utf8');
ok('only that line moved', after === orig.replace('network_mode = public', 'network_mode = offline'));

// Key absent: added under [default], not at the end of another section.
d = tmp();
fs.mkdirSync(path.join(d, '__manager'));
fs.writeFileSync(managerConfigPath(d), '[default]\nuse_uv = False\n[other]\nnetwork_mode = public\n');
setManagerOffline(d);
const t = fs.readFileSync(managerConfigPath(d), 'utf8');
ok('added to [default]', /^\[default\]\nnetwork_mode = offline\nuse_uv = False/.test(t));
ok('another section is left alone', /\[other\]\nnetwork_mode = public/.test(t));

console.log(`managerOffline: all ${pass} checks passed`);
