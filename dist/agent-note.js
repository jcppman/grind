#!/usr/bin/env node
import { appendFile, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.js';
import { gitToplevel } from './git.js';
import { withRepositoryLock } from './operations.js';
import { isContainedRelativePath, toPosix } from './paths.js';
import { readSidecar, SIDECAR_FILENAME } from './sidecar.js';
export async function addAgentNote(input) {
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 1 || input.end < input.start) {
        throw new GrindError('NOTE_INVALID', 'Line range must use positive integers with end greater than or equal to start');
    }
    if (input.comment.trim() === '')
        throw new GrindError('NOTE_INVALID', 'Comment must not be empty');
    if (input.comment.split(/\r?\n/).some((line) => /^## @.+#\d+(?:-\d+)?\s*$/.test(line))) {
        throw new GrindError('NOTE_INVALID', 'Comment cannot contain a line that looks like a note heading');
    }
    const file = await realpath(input.file).catch(() => null);
    if (file === null)
        throw new GrindError('NOTE_INVALID', `File does not exist: ${input.file}`);
    const repositoryRoot = await gitToplevel(path.dirname(file));
    if (repositoryRoot === null)
        throw new GrindError('NOTE_INVALID', `File is not inside a Git repository: ${input.file}`);
    const relative = toPosix(path.relative(repositoryRoot, file));
    if (!isContainedRelativePath(relative)) {
        throw new GrindError('PATH_ESCAPE', `File resolves outside its Git repository: ${input.file}`);
    }
    return withRepositoryLock(repositoryRoot, `agent-note-${process.pid}`, async () => {
        const contents = await readFile(file, 'utf8');
        const lines = contents.split(/\r?\n/);
        if (input.end > lines.length || (input.end === lines.length && lines.at(-1) === '')) {
            throw new GrindError('NOTE_INVALID', `Line range ${input.start}-${input.end} exceeds ${relative}`);
        }
        const existing = await readSidecar(repositoryRoot);
        if (existing?.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            throw new GrindError('NOTE_INVALID', `Repair malformed ${SIDECAR_FILENAME} before adding a note`, {
                diagnostics: existing.diagnostics,
            });
        }
        const reference = `@${relative}#${input.start}${input.end === input.start ? '' : `-${input.end}`}`;
        const anchor = lines[input.start - 1];
        const prefix = existing === null ? '' : (await readFile(existing.path, 'utf8')).endsWith('\n') ? '\n' : '\n\n';
        const block = `${prefix}## ${reference}\n> ${anchor}\n\n${input.comment.trim()}\n`;
        const sidecar = path.join(repositoryRoot, SIDECAR_FILENAME);
        await appendFile(sidecar, block, 'utf8');
        return { sidecar, reference };
    });
}
export async function runAgentNote(argv) {
    try {
        if (argv.length !== 3 && argv.length !== 4) {
            throw new GrindError('USAGE', 'Usage: agent-note <file> <start> [end] <comment>');
        }
        const [file, startText] = argv;
        const hasEnd = argv.length === 4;
        const endText = hasEnd ? argv[2] : startText;
        const comment = argv[hasEnd ? 3 : 2];
        const result = await addAgentNote({ file: file, start: Number(startText), end: Number(endText), comment });
        process.stdout.write(`${result.reference} -> ${result.sidecar}\n`);
        return 0;
    }
    catch (error) {
        const failure = error instanceof GrindError ? error : new GrindError('NOTE_INVALID', error.message);
        process.stderr.write(`agent-note: ${failure.message}\n`);
        return failure.code === 'USAGE' ? 2 : 1;
    }
}
// Windows passes argv[1] with backslashes.
const invokedDirectly = /[\\/]agent-note(\.[jt]s)?$/.test(process.argv[1] ?? '');
if (invokedDirectly)
    process.exitCode = await runAgentNote(process.argv.slice(2));
//# sourceMappingURL=agent-note.js.map