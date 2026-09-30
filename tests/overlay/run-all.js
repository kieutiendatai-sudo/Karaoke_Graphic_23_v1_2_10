'use strict';
// node tests/overlay/run-all.js  -> overlay tests + the existing (unchanged) workflow tests
const cp = require('node:child_process'), path = require('node:path');
const files = ['overlay/overlay-plan', 'overlay/overlay-ass', 'overlay/overlay-host', 'overlay/overlay-structure', 'overlay/overlay-render',
  'test', 'test-panel', 'test-batch-panel', 'test-batch-host', 'test-fast-parse', 'test-crop-reads', 'test-kf-metrics'];
let failed = 0;
for (const f of files) {
  const file = path.join(__dirname, '..', f + (f.startsWith('overlay/') ? '.test.js' : '.js'));
  const r = cp.spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const pass = (r.stdout.match(/^PASS/gm) || []).length, skip = (r.stdout.match(/^SKIP/gm) || []).length;
  console.log((r.status === 0 ? 'OK   ' : 'FAIL ') + f + '  (' + pass + ' passed' + (skip ? ', ' + skip + ' skipped' : '') + ')');
  if (r.status !== 0) { failed++; console.log(r.stdout.split('\n').filter(l => !l.startsWith('PASS')).join('\n') + r.stderr); }
}
process.exit(failed ? 1 : 0);
