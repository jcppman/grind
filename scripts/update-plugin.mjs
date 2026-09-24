import { spawnSync } from 'node:child_process';

// Some Codex CLIs on PATH predate `codex plugin`; CODEX selects another binary.
const codex = process.env.CODEX ?? 'codex';
const steps = [
  ['claude', ['plugin', 'marketplace', 'update', 'grind']],
  ['claude', ['plugin', 'update', 'grind@grind']],
  [codex, ['plugin', 'marketplace', 'upgrade', 'grind']],
  [codex, ['plugin', 'add', 'grind@grind']],
];

let failed = false;
for (const [command, args] of steps) {
  process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(`Failed: ${result.error?.message ?? `exit ${result.status}`}\n`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
