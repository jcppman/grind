import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatStatus } from './format.ts';

test('status reports missing approval without implying document maturity', () => {
  const output = formatStatus({
    resolution: { source: 'argument', stalePointer: null, checkout: null },
    inspection: {
      id: 'app/outcome',
      dir: '/workspace/state/initiatives/app/outcome',
      archived: false,
      state: null,
      legacy: false,
      artifacts: [{ path: 'spec.md', role: 'document', type: 'Specification', approvals: [] }],
      repositories: [],
      diagnostics: [],
    },
  });

  assert.match(output, /spec\.md  Specification  unapproved/);
  assert.doesNotMatch(output, /draft/);
});
