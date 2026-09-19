import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { dashboardTreeScript } from './dashboard-view.ts';

interface Entry {
  id: string;
  archived: boolean;
  status: string | null;
  task: string | null;
}
interface Group {
  path: string;
  name: string;
  groups: Map<string, Group>;
  initiatives: Entry[];
  count: number;
}
const { groupInitiatives, matchingInitiatives } = runInNewContext(dashboardTreeScript + ';({ groupInitiatives, matchingInitiatives })') as {
  groupInitiatives: (entries: Entry[]) => Group;
  matchingInitiatives: (entries: Entry[], filter: string, query: string) => Entry[];
};
const entry = (id: string, archived = false, status: string | null = 'open', task: string | null = null): Entry => ({ id, archived, status, task });

test('folder groups preserve direct initiatives, arbitrary depth, and unscoped entries', () => {
  const entries = [entry('audio/shell'), entry('audio/rytho/video'), entry('audio/rytho/setup'), entry('grind/bootstrap'), entry('loose')];
  const root = groupInitiatives(entries);
  assert.equal(root.count, 5);
  assert.equal(root.initiatives[0], entries[4]);
  const audio = root.groups.get('audio')!;
  assert.equal(audio.count, 3);
  assert.equal(audio.initiatives[0], entries[0]);
  assert.equal(audio.groups.get('rytho')?.path, 'audio/rytho');
  assert.equal(audio.groups.get('rytho')?.count, 2);
  assert.equal(root.groups.size, 2);
});

test('archived entries retain scope and distinct identity alongside active entries', () => {
  const active = entry('audio/rytho/video');
  const archived = entry('_archive/audio/rytho/video', true, 'closed');
  const root = groupInitiatives([active, archived, entry('_archive/loose', true, 'closed')]);
  const group = root.groups.get('audio')!.groups.get('rytho')!;
  assert.equal(root.groups.has('_archive'), false);
  assert.equal(group.count, 2);
  assert.equal(group.initiatives[0], active);
  assert.equal(group.initiatives[1], archived);
  assert.equal(root.initiatives.length, 1);
});

test('folder names cannot collide with object properties or path prefixes', () => {
  const root = groupInitiatives([entry('__proto__/constructor/item'), entry('audio/item'), entry('audiobook/item')]);
  assert.equal(root.groups.get('__proto__')?.groups.get('constructor')?.count, 1);
  assert.equal(root.groups.get('audio')?.count, 1);
  assert.equal(root.groups.get('audiobook')?.count, 1);
});

test('search and status filters produce only matching descendants and preserve unavailable entries in All', () => {
  const entries = [entry('audio/rytho/video', false, 'open', 'Render previews'), entry('audio/shell', false, 'closed'), entry('_archive/audio/old', true, 'closed'), entry('grind/bad', false, null)];
  assert.equal(matchingInitiatives(entries, 'all', '').length, 4);
  assert.equal(matchingInitiatives(entries, 'open', '').length, 1);
  assert.equal(matchingInitiatives(entries, 'closed', '').length, 1);
  assert.equal(matchingInitiatives(entries, 'archived', '')[0], entries[2]);
  assert.equal(matchingInitiatives(entries, 'all', ' PREVIEWS ')[0], entries[0]);
  const root = groupInitiatives(matchingInitiatives(entries, 'open', 'AUDIO'));
  assert.equal(root.count, 1);
  assert.equal(root.groups.get('audio')?.groups.get('rytho')?.count, 1);
  assert.equal(groupInitiatives(matchingInitiatives(entries, 'all', 'missing')).groups.size, 0);
});
