import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter } from './frontmatter.ts';

test('file without frontmatter keeps the whole body', () => {
  const raw = '# Title\n\nBody\n';
  const result = parseFrontmatter(raw);
  assert.equal(result.hasFrontmatter, false);
  assert.equal(result.data, null);
  assert.equal(result.body, raw);
  assert.equal(result.raw, raw);
});

test('frontmatter is split and the body preserved byte for byte', () => {
  const raw = '---\ntype: Specification\nextra:\n  nested: 1\n---\n\n# Title\n\ntext  \n';
  const result = parseFrontmatter(raw);
  assert.deepEqual(result.data, { type: 'Specification', extra: { nested: 1 } });
  assert.equal(result.body, '\n# Title\n\ntext  \n');
  assert.equal(result.raw, raw);
});

test('a leading byte-order mark does not hide the frontmatter', () => {
  const raw = '\uFEFF---\ntype: Specification\n---\nbody\n';
  const result = parseFrontmatter(raw);
  assert.deepEqual(result.data, { type: 'Specification' });
  assert.equal(result.body, 'body\n');
  assert.equal(result.raw, raw);
});

test('empty frontmatter block yields an empty mapping', () => {
  const result = parseFrontmatter('---\n---\nbody\n');
  assert.deepEqual(result.data, {});
  assert.equal(result.body, 'body\n');
});

test('malformed YAML reports an error and keeps the body', () => {
  const result = parseFrontmatter('---\ntype: [oops\n---\nbody\n');
  assert.equal(result.hasFrontmatter, true);
  assert.equal(result.data, null);
  assert.match(result.error ?? '', /Invalid YAML/);
  assert.equal(result.body, 'body\n');
});

test('unclosed frontmatter block is reported', () => {
  const result = parseFrontmatter('---\ntype: x\nbody\n');
  assert.match(result.error ?? '', /not closed/);
});

test('scalar frontmatter is rejected', () => {
  const result = parseFrontmatter('---\njust a string\n---\nbody\n');
  assert.match(result.error ?? '', /mapping/);
});
