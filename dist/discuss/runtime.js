import path from 'node:path';
import { readJson, writeJsonAtomic } from './store.js';
export const paths = {
    record: (dir) => path.join(dir, 'discussion.json'),
    state: (dir) => path.join(dir, 'state.json'),
    result: (dir) => path.join(dir, 'result.json'),
    stop: (dir) => path.join(dir, 'stop.json'),
    inputs: (dir) => path.join(dir, 'inputs'),
    application: (dir) => path.join(dir, 'application.json'),
    runnerLog: (dir) => path.join(dir, 'runner.log'),
    attempt: (dir, turnId, attempt) => path.join(dir, 'turns', turnId, `a${attempt}`),
    participant: (dir, participant) => path.join(dir, 'participants', participant),
    worker: (dir, participant, generation) => path.join(dir, 'workers', `${participant}-g${generation}.json`),
};
export const attemptFiles = {
    assignment: (attempt) => path.join(attempt, 'assignment.json'),
    brief: (attempt) => path.join(attempt, 'brief.md'),
    schema: (attempt) => path.join(attempt, 'schema.json'),
    claim: (attempt) => path.join(attempt, 'claim.json'),
    launch: (attempt) => path.join(attempt, 'launch.json'),
    running: (attempt) => path.join(attempt, 'running.json'),
    stdout: (attempt) => path.join(attempt, 'stdout.log'),
    stderr: (attempt) => path.join(attempt, 'stderr.log'),
    last: (attempt) => path.join(attempt, 'last.txt'),
    outcome: (attempt) => path.join(attempt, 'outcome.json'),
};
export async function readRecord(dir) {
    return readJson(paths.record(dir));
}
export async function readState(dir) {
    return readJson(paths.state(dir));
}
export async function writeState(dir, state) {
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.state(dir), state);
}
export function isFinal(status) {
    return status === 'completed' || status === 'cancelled';
}
//# sourceMappingURL=runtime.js.map