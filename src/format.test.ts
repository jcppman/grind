import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatStatus } from './format.ts';

test('status reports artifact roles', () => {
  const output = formatStatus({
    resolution: { source: 'argument', stalePointer: null, checkout: null },
    pendingOperations: [],
    inspection: {
      id: 'app/outcome',
      dir: '/workspace/state/initiatives/app/outcome',
      archived: false,
      state: null,
      legacy: false,
      artifacts: [{ path: 'spec.md', role: 'document', type: 'Specification' }],
      repositories: [],
      diagnostics: [],
    },
  });

  assert.match(output, /\n    spec\.md  Specification$/);
});
