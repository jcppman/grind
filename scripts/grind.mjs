#!/usr/bin/env node
import { run } from '../dist/cli.js';

if (Number(process.versions.node.split('.')[0]) < 24) {
  process.stderr.write('Grind requires Node.js 24 or later.\n');
  process.exitCode = 1;
} else {
  process.exitCode = await run(process.argv.slice(2));
}
