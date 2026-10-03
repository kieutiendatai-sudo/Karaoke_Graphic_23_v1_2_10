'use strict';
// Tiny runner: tests may be async; failures set a non-zero exit code and stop after the report.
const queue = [];
let failed = 0;
function test(name, fn) { queue.push({ name, fn }); }
function skip(reason) { console.log('SKIP ' + reason); }
setImmediate(async function run() {
  for (const t of queue) {
    try { await t.fn(); console.log('PASS ' + t.name); } catch (e) { failed++; console.log('FAIL ' + t.name + '\n  ' + (e && e.stack || e)); }
  }
  if (failed) { console.log(failed + ' failed'); process.exitCode = 1; }
});
module.exports = { test, skip };
