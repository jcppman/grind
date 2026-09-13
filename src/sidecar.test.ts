import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSidecar } from './sidecar.ts';

test('parses the pointer and note blocks with anchors', () => {
  const raw = `---
initiative: givery/tcm-seamless-signin
---

## @src/auth/login.ts#42-58
> const result = await retry(() => signIn(user), 3);

The retry loop swallows the error. Surface it to the caller.

## @README.md#3

Is this still accurate?
`;
  const sidecar = parseSidecar(raw, '.grind.md');
  assert.deepEqual(sidecar.diagnostics, []);
  assert.equal(sidecar.initiative, 'givery/tcm-seamless-signin');
  assert.deepEqual(sidecar.notes, [
    {
      reference: '@src/auth/login.ts#42-58',
      path: 'src/auth/login.ts',
      start: 42,
      end: 58,
      anchor: 'const result = await retry(() => signIn(user), 3);',
      body: 'The retry loop swallows the error. Surface it to the caller.',
    },
    { reference: '@README.md#3', path: 'README.md', start: 3, end: 3, anchor: null, body: 'Is this still accurate?' },
  ]);
});

test('notes without a pointer are still read', () => {
  const sidecar = parseSidecar('## @a.ts#1-2\n\nfix\n', '.grind.md');
  assert.equal(sidecar.initiative, null);
  assert.equal(sidecar.notes.length, 1);
});

test('an empty or malformed pointer is diagnosed', () => {
  assert.ok(parseSidecar('---\ninitiative: ""\n---\n', '.grind.md').diagnostics.some((d) => d.code === 'SIDECAR_INVALID'));
  assert.ok(parseSidecar('---\ninitiative: [\n---\n', '.grind.md').diagnostics.some((d) => d.code === 'SIDECAR_INVALID'));
});
