import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatList, formatStatus } from './format.ts';

test('list separates initiatives and wraps long actions with a hanging indent', () => {
  const output = formatList({
    initiatives: [
      {
        id: 'app/one',
        dir: '/workspace/state/initiatives/app/one',
        status: 'open',
        updated_at: '2026-09-17T16:10:00+09:00',
        phase: 'implementation',
        current_task: 'Review the pull request',
        next_action: 'Open a draft pull request and verify the reproduction scenario in the shared environment',
        result: null,
        diagnostics: [],
      },
      {
        id: 'app/two',
        dir: '/workspace/state/initiatives/app/two',
        status: 'open',
        updated_at: '2026-09-18T15:04:22+09:00',
        phase: 'design',
        current_task: 'Plan milestone 2',
        next_action: 'Begin implementation',
        result: null,
        diagnostics: [],
      },
    ],
    diagnostics: [],
  }, { width: 60 });

  assert.equal(output, `2 open initiatives

app/one  [open]
  Task     Review the pull request
  Next     Open a draft pull request and verify the
           reproduction scenario in the shared environment
  Updated  2026-09-17 16:10 +09:00

app/two  [open]
  Task     Plan milestone 2
  Next     Begin implementation
  Updated  2026-09-18 15:04 +09:00`);
  assert.ok(output.split('\n').every((line) => line.length <= 60));
});

test('human formatting can add restrained status color without affecting plain output', () => {
  const result = {
    initiatives: [{
      id: 'app/one',
      dir: '/workspace/state/initiatives/app/one',
      status: 'open' as const,
      updated_at: '2026-09-17T16:10:00+09:00',
      phase: 'implementation',
      current_task: 'Review',
      next_action: 'Continue',
      result: null,
      diagnostics: [],
    }],
    diagnostics: [],
  };

  assert.doesNotMatch(formatList(result, { color: false }), /\u001B\[/);
  assert.match(formatList(result, { color: true }), /\u001B\[32m\[open\]/);
});

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
