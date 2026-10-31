import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GrindError } from '../errors.js';
const exec = promisify(execFile);
const LOCK_WAIT_MS = 10_000;
const ID = /^d-[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$/;
export function discussionsRoot(env = process.env) {
    const base = env['XDG_STATE_HOME'] && path.isAbsolute(env['XDG_STATE_HOME']) ? env['XDG_STATE_HOME'] : path.join(os.homedir(), '.local', 'state');
    return path.join(base, 'grind', 'discussions');
}
export function newDiscussionId(now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `d-${stamp}-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
}
export function discussionDir(id, env = process.env) {
    if (!ID.test(id))
        throw new GrindError('USAGE', `Invalid discussion ID ${id}`);
    return path.join(discussionsRoot(env), id);
}
export async function ensurePrivateDir(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
}
export async function readJson(file) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw new GrindError('DISCUSSION_INVALID', `Cannot read ${file}: ${error.message}`, { path: file });
    }
}
export async function writeJsonAtomic(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    try {
        await rename(temp, file);
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}
/** Creates `file` only if it does not exist; returns false when another process created it first. */
export async function writeJsonExclusive(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
        await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        return true;
    }
    catch (error) {
        if (error.code === 'EEXIST')
            return false;
        throw error;
    }
}
export async function appendEvent(dir, event) {
    await appendFile(path.join(dir, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
}
export async function readEvents(dir) {
    let raw;
    try {
        raw = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const events = [];
    // A crash can leave one torn final line; every complete line before it stays valid.
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch {
            break;
        }
    }
    return events;
}
export function createProcessProbe(readStartTime = async (pid) => {
    const { stdout } = await exec('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } });
    return stdout;
}) {
    return {
        async identify(pid) {
            if (!Number.isSafeInteger(pid) || pid <= 0)
                return null;
            try {
                const started = (await readStartTime(pid)).trim();
                return started ? { pid, started } : null;
            }
            catch (error) {
                const failure = error;
                if (failure.code === 1 && failure.stdout === '' && failure.stderr === '')
                    return null;
                throw new GrindError('PROCESS_INSPECTION_FAILED', 'Cannot inspect discussion processes. Retry with process-inspection permission before deciding whether recovery is needed.', { pid });
            }
        },
    };
}
export const systemProbe = createProcessProbe();
export async function isSameProcess(identity, probe = systemProbe) {
    if (!identity)
        return false;
    const current = await probe.identify(identity.pid);
    return current !== null && current.started === identity.started;
}
/** Signals a process group only after confirming it is still the recorded process. */
export async function terminateOwned(identity, signal = 'SIGTERM', probe = systemProbe) {
    if (!identity || !(await isSameProcess(identity, probe)))
        return false;
    try {
        process.kill(-identity.pid, signal);
    }
    catch {
        try {
            process.kill(identity.pid, signal);
        }
        catch {
            return false;
        }
    }
    return true;
}
/** Short mutual exclusion around a read-modify-write; never held across a model turn. */
export async function withLock(dir, name, action, probe = systemProbe) {
    const lock = path.join(dir, `${name}.lock`);
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        try {
            await mkdir(lock, { mode: 0o700 });
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const owner = await readJson(path.join(lock, 'owner.json')).catch(() => null);
            if (owner && !(await isSameProcess(owner, probe))) {
                await rm(lock, { recursive: true, force: true });
                continue;
            }
            if (Date.now() > deadline)
                throw new GrindError('DISCUSSION_LOCKED', `Discussion lock ${lock} is held`, { lock, owner });
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    try {
        const self = await probe.identify(process.pid);
        if (self)
            await writeFile(path.join(lock, 'owner.json'), JSON.stringify(self), { mode: 0o600 });
        return await action();
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
export async function listDiscussionIds(env = process.env) {
    try {
        return (await readdir(discussionsRoot(env))).filter((name) => ID.test(name)).sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
//# sourceMappingURL=store.js.map