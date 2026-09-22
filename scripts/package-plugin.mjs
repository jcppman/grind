import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'build', 'grind');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const codexManifest = JSON.parse(await readFile(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const claudeManifest = JSON.parse(await readFile(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(await readFile(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
if (pkg.version !== codexManifest.version.replace(/\+codex\.\d+$/, '') || pkg.version !== claudeManifest.version) {
  throw new Error('CLI, Codex plugin, and Claude Code plugin versions must match');
}
if (!marketplace.plugins.some((plugin) => plugin.name === 'grind' && plugin.source === './')) {
  throw new Error('Claude Code marketplace must expose the repository-root Grind plugin');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const folder of ['dist', 'docs', 'skills', 'hooks', '.codex-plugin', '.claude-plugin']) {
  await cp(path.join(root, folder), path.join(output, folder), { recursive: true });
}
await writeFile(path.join(output, '.codex-plugin', 'plugin.json'), JSON.stringify({ ...codexManifest, version: pkg.version }, null, 2) + '\n');
await mkdir(path.join(output, 'scripts'));
await cp(path.join(root, 'scripts', 'grind.mjs'), path.join(output, 'scripts', 'grind.mjs'));
await writeFile(path.join(output, 'package.json'), JSON.stringify({ ...pkg, scripts: undefined, devDependencies: undefined }, null, 2) + '\n');
await cp(path.join(root, 'package-lock.json'), path.join(output, 'package-lock.json'));
for (const name of Object.keys(pkg.dependencies)) {
  await cp(path.join(root, 'node_modules', name), path.join(output, 'node_modules', name), { recursive: true, dereference: true });
}
process.stdout.write(`Plugin ${pkg.version}: ${output}\n`);
