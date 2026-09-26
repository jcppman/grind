import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { isInitiativeRoot } from './discovery.js';
import { readInitiative } from './artifacts.js';
import { GrindError } from './errors.js';
import { git } from './git.js';
import { pathsBelow, resolveWithin, toPosix } from './paths.js';
import { assertNoPendingOperation, withLifecycleLocks } from './operations.js';
import { resolveInitiative } from './resolve.js';
import { findNestedWorkspaceConfig } from './workspace.js';
export async function checkedGit(root, ...args) {
    const result = await git(args, root);
    if (!result.ok)
        throw new GrindError('GIT_ERROR', result.stderr.trim() || `git ${args[0]} failed`);
    return result.stdout;
}
export async function withStateLock(workspace, action) {
    return withLifecycleLocks(workspace, [], `state-${process.pid}`, action);
}
export async function rejectSymlinks(base, target) {
    for (const item of [base, ...pathsBelow(base, target).reverse()]) {
        const info = await lstat(item).catch((error) => {
            if (error.code === 'ENOENT')
                return null;
            throw error;
        });
        if (info?.isSymbolicLink())
            throw new GrindError('PATH_ESCAPE', `Symbolic links are not allowed beneath initiatives/: ${item}`);
    }
}
export async function validateForWrite(workspace, dir) {
    await rejectSymlinks(workspace.initiativesDir, dir);
    await rejectNestedRepositories(dir);
    const record = await readInitiative(dir, { workspace });
    const invalid = record.diagnostics.filter((d) => d.severity === 'error' || d.code === 'LEGACY_RECORD' || d.code === 'TYPE_MISMATCH');
    if (invalid.length > 0 || !record.ledgerState?.state) {
        throw new GrindError('ARTIFACT_INVALID', 'Repair initiative artifacts before writing', { diagnostics: invalid });
    }
}
async function rejectNestedRepositories(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === '.git')
            throw new GrindError('ARTIFACT_INVALID', `Nested Git repositories cannot be checkpointed: ${dir}`);
        if (entry.isDirectory())
            await rejectNestedRepositories(path.join(dir, entry.name));
    }
}
export async function createCommand(context, name, scope) {
    if (!name.trim() || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name) || name === '_archive') {
        throw new GrindError('USAGE', 'Initiative name must be a single nonempty path component other than _archive');
    }
    const { workspace } = context;
    let prefix = '';
    if (scope !== undefined) {
        const target = await resolveWithin(workspace.root, scope);
        if (await findNestedWorkspaceConfig(workspace.root, target))
            throw new GrindError('PATH_ESCAPE', 'Scope belongs to a nested workspace');
        const info = await lstat(target).catch(() => null);
        if (!info?.isDirectory())
            throw new GrindError('USAGE', 'Scope must identify an existing workspace folder');
        prefix = toPosix(path.relative(workspace.root, target));
    }
    const id = prefix ? `${prefix}/${name}` : name;
    if (id.split('/').includes('_archive'))
        throw new GrindError('USAGE', '_archive is reserved');
    return withStateLock(workspace, async () => {
        const lexical = path.join(workspace.initiativesDir, id);
        await rejectSymlinks(workspace.initiativesDir, lexical);
        const dir = await resolveWithin(workspace.initiativesDir, id);
        for (const ancestor of pathsBelow(workspace.initiativesDir, path.dirname(dir))) {
            if (await isInitiativeRoot(ancestor)) {
                throw new GrindError('INITIATIVE_EXISTS', `Cannot nest an initiative beneath ${ancestor}`);
            }
        }
        await mkdir(path.dirname(dir), { recursive: true });
        try {
            await mkdir(dir);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw new GrindError('INITIATIVE_EXISTS', `Destination already exists: ${dir}`);
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
            'intent.md': `---\ntype: Intent\ngrind:\n  root: true\n---\n\n# ${name}\n\n## Purpose\n\nDescribe the problem and intended outcome.\n\n## Success criteria\n\nDescribe how completion will be verified.\n`,
            'ledger.md': `---\n${stringify(ledger)}---\n\n# Initiative Ledger\n\n## Working state\n\nInitiative created; intent needs elaboration.\n`,
        };
        try {
            for (const [file, content] of Object.entries(files))
                await writeFile(path.join(dir, file), content, { flag: 'wx' });
            await validateForWrite(workspace, dir);
        }
        catch (error) {
            throw new GrindError('WRITE_FAILED', `Creation is incomplete at ${dir}; inspect it before retrying. ${error.message}`, { dir });
        }
        return { id, dir, created: Object.keys(files) };
    });
}
export async function saveCommand(context, identifier, message) {
    if (!message.trim())
        throw new GrindError('USAGE', 'save requires a nonempty --message');
    const { workspace } = context;
    return withStateLock(workspace, async () => {
        const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
        await assertNoPendingOperation(workspace, initiative.id);
        if (initiative.archived)
            throw new GrindError('UNSUPPORTED_OPERATION', 'Archived initiatives are read-only');
        const root = workspace.stateGitRoot;
        if ((await checkedGit(root, 'diff', '--cached', '--name-only', '-z')).length) {
            throw new GrindError('INDEX_NOT_CLEAN', 'State repository has staged changes; resolve the index before saving');
        }
        await validateForWrite(workspace, initiative.dir);
        const relative = toPosix(path.relative(root, initiative.dir));
        const pathspec = `:(literal)${relative}`;
        await checkedGit(root, 'add', '-A', '--', pathspec);
        const staged = await checkedGit(root, 'diff', '--cached', '--name-only', '-z');
        if (!staged)
            return { id: initiative.id, saved: false, commit: null };
        const result = await git(['commit', '-m', message], root);
        if (!result.ok) {
            throw new GrindError('COMMIT_FAILED', 'Checkpoint commit failed. Files and staged changes are preserved; inspect git status and resolve the index before retrying.', { stderr: result.stderr, status: await checkedGit(root, 'status', '--porcelain') });
        }
        return { id: initiative.id, saved: true, commit: (await checkedGit(root, 'rev-parse', 'HEAD')).trim() };
    });
}
//# sourceMappingURL=writes.js.map