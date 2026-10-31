import { execFile } from 'node:child_process';
import { access, constants, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { GrindError } from '../errors.js';
const exec = promisify(execFile);
/** Claude participants can read and search but have no tool that writes, runs commands or fetches. */
export const CLAUDE_READ_ONLY_TOOLS = 'Read,Grep,Glob';
/** cmux puts agent wrappers on PATH inside its terminals; participants must never resolve to one by accident. */
export function isCmuxShim(file) {
    return /\.app\/Contents\/Resources\/bin\//.test(file) || /cmux-[a-z-]+-wrapper$/.test(file);
}
export async function resolveExecutable(engine, settings, env = process.env) {
    let candidate = null;
    let source = 'path';
    if (settings) {
        candidate = settings.executable;
        source = 'personal';
    }
    else {
        for (const dir of (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
            const file = path.join(dir, engine);
            try {
                await access(file, constants.X_OK);
            }
            catch {
                continue;
            }
            const real = await realpath(file).catch(() => file);
            if (isCmuxShim(file) || isCmuxShim(real))
                continue;
            candidate = file;
            break;
        }
    }
    if (candidate === null)
        throw new GrindError('ENGINE_UNAVAILABLE', `No ${engine} executable found on PATH; set engines.${engine}.executable in personal settings`);
    let realPath;
    try {
        await access(candidate, constants.X_OK);
        realPath = await realpath(candidate);
    }
    catch {
        throw new GrindError('ENGINE_UNAVAILABLE', `${engine} executable ${candidate} is not executable`);
    }
    if (isCmuxShim(realPath))
        throw new GrindError('ENGINE_UNAVAILABLE', `${candidate} resolves to a cmux wrapper; set engines.${engine}.executable to the real CLI`);
    let version;
    try {
        version = (await exec(realPath, ['--version'], { timeout: 15_000, env })).stdout.trim();
    }
    catch (error) {
        throw new GrindError('ENGINE_UNAVAILABLE', `${engine} --version failed: ${error.message}`);
    }
    return { engine, source, path: candidate, realPath, version };
}
/** Command-line arguments for one bounded, read-only turn; the prompt is written to stdin. */
export function engineArgs(invocation) {
    if (invocation.engine === 'claude') {
        if (invocation.sessionId === null)
            throw new GrindError('DISCUSSION_STATE', 'Claude turns require an explicit session ID');
        return [
            '-p', '--model', invocation.model,
            invocation.resume ? '--resume' : '--session-id', invocation.sessionId,
            '--restricted', '--strict-mcp-config', '--tools', CLAUDE_READ_ONLY_TOOLS, '--permission-mode', 'dontAsk',
            ...invocation.readableRoots.flatMap((root) => ['--add-dir', root]),
            '--output-format', 'stream-json', '--verbose',
            '--json-schema', JSON.stringify(invocation.schema),
        ];
    }
    // `exec resume` has no --sandbox flag, so both paths set the sandbox through configuration.
    const common = ['--skip-git-repo-check', '-m', invocation.model, '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '--json', '-o', invocation.lastMessageFile, '--output-schema', invocation.schemaFile];
    if (invocation.resume) {
        if (invocation.sessionId === null)
            throw new GrindError('DISCUSSION_STATE', 'Resuming a Codex turn requires its thread ID');
        return ['exec', 'resume', invocation.sessionId, ...common, '-'];
    }
    return ['exec', '-C', invocation.cwd, ...common, '-'];
}
/** Interprets the JSON-lines stream an engine wrote to stdout, plus Codex's last-message file. */
export function parseEngineOutput(engine, stdout, lastMessage) {
    const events = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim().startsWith('{'))
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch {
            // Partial lines from an interrupted engine carry no result.
        }
    }
    if (engine === 'claude') {
        const init = events.find((event) => event['type'] === 'system' && event['subtype'] === 'init');
        const result = events.findLast((event) => event['type'] === 'result');
        let output = null;
        let error = null;
        if (!result)
            error = 'Claude produced no result event';
        else if (result['is_error'] === true)
            error = `Claude result error: ${String(result['subtype'] ?? 'unknown')}`;
        else if (result['structured_output'] !== undefined && result['structured_output'] !== null)
            output = result['structured_output'];
        else
            output = parseJson(String(result['result'] ?? ''));
        if (error === null && output === null)
            error = 'Claude result was not JSON';
        return { sessionId: typeof init?.['session_id'] === 'string' ? init['session_id'] : null, model: typeof init?.['model'] === 'string' ? init['model'] : null, output, error };
    }
    const started = events.find((event) => event['type'] === 'thread.started');
    const failed = events.findLast((event) => event['type'] === 'turn.failed' || event['type'] === 'error');
    const completed = events.some((event) => event['type'] === 'turn.completed');
    const output = lastMessage === null ? null : parseJson(lastMessage);
    let error = null;
    if (failed && !completed)
        error = `Codex turn failed: ${JSON.stringify(failed['error'] ?? failed['message'] ?? failed)}`;
    else if (output === null)
        error = 'Codex produced no JSON final message';
    return { sessionId: typeof started?.['thread_id'] === 'string' ? started['thread_id'] : null, model: null, output, error };
}
function parseJson(text) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
const issue = (kinds) => ({
    type: 'object',
    additionalProperties: false,
    required: ['id', 'kind', 'text', 'evidence'],
    properties: { id: { type: 'string' }, kind: { type: 'string', enum: kinds }, text: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } },
});
/** Output schema for a turn; strict enough for Codex, which requires every property to be listed as required. */
export function responseSchema(kind) {
    const envelope = {
        discussionId: { type: 'string' },
        participant: { type: 'string' },
        turnId: { type: 'string' },
        phase: { type: 'string', enum: [kind] },
        revision: { type: ['integer', 'null'] },
        snapshotId: { type: 'string' },
    };
    const specific = {
        assess: { summary: { type: 'string' }, findings: { type: 'array', items: issue(['finding', 'objection', 'evidence_request', 'user_question']) } },
        draft: {
            summary: { type: 'string' },
            documents: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['target', 'content'], properties: { target: { type: 'string' }, content: { type: 'string' } } } },
            assumptions: { type: 'array', items: { type: 'string' } },
            dispositions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['issueId', 'disposition', 'rationale'], properties: { issueId: { type: 'string' }, disposition: { type: 'string', enum: ['accepted', 'rejected', 'deferred'] }, rationale: { type: 'string' } } } },
        },
        ratify: { decision: { type: 'string', enum: ['accept', 'object'] }, candidateHash: { type: 'string' }, objections: { type: 'array', items: issue(['objection', 'evidence_request', 'user_question']) } },
    };
    const properties = { ...envelope, ...specific[kind] };
    return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
//# sourceMappingURL=engines.js.map