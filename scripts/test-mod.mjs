import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// `claude plugin test` runs every *.test.ts under its folder, so the mod's tests
// run in a copy holding only the manifest and mod/, not the CLI's node tests.
const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'grind-mod-test-'));
try {
  await cp(path.join(root, '.claude-plugin', 'plugin.json'), path.join(temp, '.claude-plugin', 'plugin.json'));
  await cp(path.join(root, 'mod'), path.join(temp, 'mod'), { recursive: true });
  execFileSync('claude', ['plugin', 'test', temp], { stdio: 'inherit' });
} finally {
  await rm(temp, { recursive: true, force: true });
}
