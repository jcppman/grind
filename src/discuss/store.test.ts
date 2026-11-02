import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProcessProbe, isSameProcess, terminateOwned } from './store.ts';

const identity = { pid: 123, started: 'Fri Oct 30 09:45:02 2026' };

test('process identity distinguishes a matching process, PID reuse and an exited process', async () => {
  assert.equal(await isSameProcess(identity, createProcessProbe(async () => identity.started)), true);
  assert.equal(await isSameProcess(identity, createProcessProbe(async () => 'another start time')), false);
  assert.equal(await isSameProcess(identity, createProcessProbe(async () => '')), false);
  const absent = createProcessProbe(async () => { throw { code: 1, stdout: '', stderr: '' }; });
  assert.equal(await isSameProcess(identity, absent), false);
});

for (const failure of [
  { code: 'EPERM' },
  { code: 'EACCES' },
  { code: 1, stdout: '', stderr: 'ps: operation not permitted' },
  { code: 'ENOENT' },
]) {
  test(`inspection failure ${JSON.stringify(failure)} is not proof of absence`, async () => {
    const probe = createProcessProbe(async () => { throw failure; });
    await assert.rejects(isSameProcess(identity, probe), { code: 'PROCESS_INSPECTION_FAILED' });
    await assert.rejects(terminateOwned(identity, 'SIGTERM', probe), { code: 'PROCESS_INSPECTION_FAILED' });
  });
}
