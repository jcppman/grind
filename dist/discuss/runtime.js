import path from 'node:path';
import { readJson, writeJsonAtomic } from './store.js';
export const paths = {
    record: (dir) => path.join(dir, 'discussion.json'),
    state: (dir) => path.join(dir, 'state.json'),
    result: (dir) => path.join(dir, 'result.json'),
    stop: (dir) => path.join(dir, 'stop.json'),
    submission: (dir, turnId) => path.join(dir, 'submissions', `${turnId}.json`),
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
    const state = await readJson(paths.state(dir));
    // State written by an older version may wait for a presentation choice that no longer exists; it resumes as a normal start.
    if (state !== null && state.status === 'needs_presentation_choice') {
        state.status = 'needs_recovery';
        state.error = 'Created by an earlier Grind version and never started; resume it to start';
    }
    return state;
}
export async function writeState(dir, state) {
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.state(dir), state);
}
export function isFinal(status) {
    return status === 'completed' || status === 'cancelled';
}
//# sourceMappingURL=runtime.js.map