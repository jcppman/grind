import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { readInitiative } from './artifacts.ts';
import type { CommandContext } from './commands.ts';
import { GrindError } from './errors.ts';
import { git } from './git.ts';
import { pathsBelow, resolveWithin, toPosix } from './paths.ts';
import { resolveInitiative } from './resolve.ts';
import { findNestedWorkspaceConfig, type Workspace } from './workspace.ts';

export async function checkedGit(root: string, ...args: string[]): Promise<string> {
  const result = await git(args, root);
  if (!result.ok) throw new GrindError('GIT_ERROR', result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

export async function withStateLock<T>(workspace: Workspace, action: () => Promise<T>): Promise<T> {
  const common = (await checkedGit(workspace.stateGitRoot, 'rev-parse', '--git-common-dir')).trim();
  const lock = path.resolve(workspace.stateGitRoot, common, 'grind-write.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => 'Owner information unavailable');
    throw new GrindError('STATE_LOCKED', `State repository is locked at ${lock}. Verify the owner has exited before manually removing this directory.`, { lock, owner });
  }
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }));
    return await action();
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function rejectSymlinks(base: string, target: string): Promise<void> {
  for (const item of [base, ...pathsBelow(base, target).reverse()]) {
    const info = await lstat(item).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new GrindError('PATH_ESCAPE', `Symbolic links are not allowed beneath initiatives/: ${item}`);
  }
}

export async function validateForWrite(workspace: Workspace, dir: string): Promise<void> {
  await rejectSymlinks(workspace.initiativesDir, dir);
  await rejectNestedRepositories(dir);
  const record = await readInitiative(dir, { workspace });
  const invalid = record.diagnostics.filter((d) => d.severity === 'error' || d.code === 'LEGACY_RECORD' || d.code === 'TYPE_MISMATCH');
  if (invalid.length > 0 || !record.ledgerState?.state) {
    throw new GrindError('ARTIFACT_INVALID', 'Repair initiative artifacts before writing', { diagnostics: invalid });
  }
}

async function rejectNestedRepositories(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') throw new GrindError('ARTIFACT_INVALID', `Nested Git repositories cannot be checkpointed: ${dir}`);
    if (entry.isDirectory()) await rejectNestedRepositories(path.join(dir, entry.name));
  }
}

export async function createCommand(context: CommandContext, name: string, scope?: string) {
  if (!name.trim() || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name) || name === '_archive') {
    throw new GrindError('USAGE', 'Initiative name must be a single nonempty path component other than _archive');
  }
  const { workspace } = context;
  let prefix = '';
  if (scope !== undefined) {
    const target = await resolveWithin(workspace.root, scope);
    if (await findNestedWorkspaceConfig(workspace.root, target)) throw new GrindError('PATH_ESCAPE', 'Scope belongs to a nested workspace');
    const info = await lstat(target).catch(() => null);
    if (!info?.isDirectory()) throw new GrindError('USAGE', 'Scope must identify an existing workspace folder');
    prefix = toPosix(path.relative(workspace.root, target));
  }
  const id = prefix ? `${prefix}/${name}` : name;
  if (id.split('/').includes('_archive')) throw new GrindError('USAGE', '_archive is reserved');
  return withStateLock(workspace, async () => {
    const lexical = path.join(workspace.initiativesDir, id);
    await rejectSymlinks(workspace.initiativesDir, lexical);
    const dir = await resolveWithin(workspace.initiativesDir, id);
    for (const ancestor of pathsBelow(workspace.initiativesDir, path.dirname(dir))) {
      if (await lstat(path.join(ancestor, 'intent.md')).catch(() => null)) {
        throw new GrindError('INITIATIVE_EXISTS', `Cannot nest an initiative beneath ${ancestor}`);
      }
    }
    await mkdir(path.dirname(dir), { recursive: true });
    try {
      await mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new GrindError('INITIATIVE_EXISTS', `Destination already exists: ${dir}`);
      throw error;
    }
    const ledger = {
      type: 'Initiative Ledger',
      grind: {
        status: 'open',
        updated_at: new Date().toISOString(),
        phase: 'discovery',
        current_task: 'Clarify the intended outcome',
        next_action: 'Define the purpose and success criteria in intent.md',
        repositories: [],
      },
    };
    const files = {
      'index.md': '# Initiative\n\n- [Intent](intent.md): purpose and outcome.\n- [Ledger](ledger.md): current state and next action.\n',
      'intent.md': `---\ntype: Initiative Intent\n---\n\n# ${name}\n\n## Purpose\n\nDescribe the problem and intended outcome.\n\n## Success criteria\n\nDescribe how completion will be verified.\n`,
      'ledger.md': `---\n${stringify(ledger)}---\n\n# Initiative Ledger\n\n## Working state\n\nInitiative created; intent needs elaboration.\n`,
    };
    try {
      for (const [file, content] of Object.entries(files)) await writeFile(path.join(dir, file), content, { flag: 'wx' });
      await validateForWrite(workspace, dir);
    } catch (error) {
      throw new GrindError('WRITE_FAILED', `Creation is incomplete at ${dir}; inspect it before retrying. ${(error as Error).message}`, { dir });
    }
    return { id, dir, created: Object.keys(files) };
  });
}

export async function saveCommand(context: CommandContext, identifier: string | undefined, message: string) {
  if (!message.trim()) throw new GrindError('USAGE', 'save requires a nonempty --message');
  const { workspace } = context;
  return withStateLock(workspace, async () => {
    const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
    if (initiative.archived) throw new GrindError('UNSUPPORTED_OPERATION', 'Archived initiatives are read-only');
    const root = workspace.stateGitRoot;
    if ((await checkedGit(root, 'diff', '--cached', '--name-only', '-z')).length) {
      throw new GrindError('INDEX_NOT_CLEAN', 'State repository has staged changes; resolve the index before saving');
    }
    await validateForWrite(workspace, initiative.dir);
    const relative = toPosix(path.relative(root, initiative.dir));
    const pathspec = `:(literal)${relative}`;
    await checkedGit(root, 'add', '-A', '--', pathspec);
    const staged = await checkedGit(root, 'diff', '--cached', '--name-only', '-z');
    if (!staged) return { id: initiative.id, saved: false, commit: null };
    const result = await git(['commit', '-m', message], root);
    if (!result.ok) {
      throw new GrindError('COMMIT_FAILED', 'Checkpoint commit failed. Files and staged changes are preserved; inspect git status and resolve the index before retrying.', { stderr: result.stderr, status: await checkedGit(root, 'status', '--porcelain') });
    }
    return { id: initiative.id, saved: true, commit: (await checkedGit(root, 'rev-parse', 'HEAD')).trim() };
  });
}
