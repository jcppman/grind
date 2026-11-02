import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDiscussionWorkspace, type CmuxAdapter } from './cmux.ts';

function recordingCmux(): CmuxAdapter & { closed: string[] } {
  const closed: string[] = [];
  return {
    closed,
    available: async () => ({ ok: true }),
    openWorkspace: async () => ({ workspace: 'workspace:1', surface: null }),
    addPane: async () => ({ surface: null }),
    renameOwnTab: async () => undefined,
    closeWorkspace: async (workspace) => { closed.push(workspace); },
  };
}

test('closes a cmux discussion workspace only by UUID', async () => {
  const cmux = recordingCmux();
  const uuid = 'BE10F808-FFFA-42A0-B618-C06356E7D1EB';
  assert.equal(await closeDiscussionWorkspace(cmux, { kind: 'cmux', workspace: 'workspace:1000290012' }), false);
  assert.equal(await closeDiscussionWorkspace(cmux, { kind: 'cmux', workspace: null }), false);
  assert.equal(await closeDiscussionWorkspace(cmux, { kind: 'headless', workspace: uuid }), false);
  assert.equal(await closeDiscussionWorkspace(null, { kind: 'cmux', workspace: uuid }), false);
  assert.equal(await closeDiscussionWorkspace(cmux, { kind: 'cmux', workspace: uuid }), true);
  assert.deepEqual(cmux.closed, [uuid]);
});
