import { fileURLToPath } from 'node:url';
import { sessionContext } from '../dist/context-hook.js';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('SessionStart input is too large');
  }
  const context = await sessionContext(JSON.parse(raw), pluginRoot);
  if (context !== null) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) + '\n');
  }
} catch {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Grind could not read SessionStart input. Use /grind:context to load context explicitly.' } }) + '\n');
}
