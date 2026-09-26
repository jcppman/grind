import { stringify } from 'yaml';
import { GrindError } from './errors.js';
import { isRecord, parseFrontmatter } from './frontmatter.js';
function ledgerParts(raw) {
    const parsed = parseFrontmatter(raw);
    if (parsed.error !== undefined || parsed.data === null || !isRecord(parsed.data['grind'])) {
        throw new GrindError('ARTIFACT_INVALID', parsed.error ?? 'Ledger requires a grind mapping');
    }
    return { data: { ...parsed.data }, grind: { ...parsed.data['grind'] }, body: parsed.body };
}
function render(data, grind, body) {
    return `---\n${stringify({ ...data, grind })}---\n${body}`;
}
function appendHistory(body, entry) {
    const heading = body.includes('\n## Lifecycle history\n') || body.startsWith('## Lifecycle history\n')
        ? ''
        : `${body === '' || body.endsWith('\n') ? '' : '\n'}\n## Lifecycle history\n`;
    return `${body}${heading}\n${entry.trim()}\n`;
}
export function closeLedger(raw, input) {
    const { data, grind, body } = ledgerParts(raw);
    if (grind['status'] !== 'open')
        throw new GrindError('UNSUPPORTED_OPERATION', 'Only an open initiative can be closed');
    for (const key of ['phase', 'current_task', 'next_action']) {
        if (typeof grind[key] !== 'string' || grind[key].trim() === '') {
            throw new GrindError('ARTIFACT_INVALID', `Open ledger requires grind.${key} before closing`);
        }
    }
    grind['resume'] = {
        phase: grind['phase'],
        current_task: grind['current_task'],
        next_action: grind['next_action'],
    };
    delete grind['phase'];
    delete grind['current_task'];
    delete grind['next_action'];
    grind['status'] = 'closed';
    grind['updated_at'] = input.updatedAt;
    grind['result'] = input.result;
    grind['closed'] = { date: input.date, outcome: input.outcome };
    const history = `### Closed ${input.date}\n\n- Outcome: ${input.outcome}\n- Result: ${input.result}`;
    return render(data, grind, appendHistory(body, history));
}
export function reopenLedger(raw, updatedAt) {
    const { data, grind, body } = ledgerParts(raw);
    if (grind['status'] !== 'closed')
        throw new GrindError('UNSUPPORTED_OPERATION', 'Only a closed initiative can be reopened');
    const resume = grind['resume'];
    if (!isRecord(resume) || !['phase', 'current_task', 'next_action'].every((key) => typeof resume[key] === 'string' && resume[key].trim() !== '')) {
        throw new GrindError('ARTIFACT_INVALID', 'Closed ledger has no valid resumable checkpoint');
    }
    const closed = isRecord(grind['closed']) ? grind['closed'] : {};
    const result = typeof grind['result'] === 'string' ? grind['result'] : '';
    grind['status'] = 'open';
    grind['updated_at'] = updatedAt;
    grind['phase'] = resume['phase'];
    grind['current_task'] = resume['current_task'];
    grind['next_action'] = resume['next_action'];
    delete grind['result'];
    delete grind['closed'];
    delete grind['resume'];
    const history = `### Reopened ${updatedAt.slice(0, 10)}\n\n- Prior closure: ${String(closed['date'] ?? '?')} (${String(closed['outcome'] ?? '?')})\n- Prior result: ${result}`;
    return render(data, grind, appendHistory(body, history));
}
//# sourceMappingURL=transitions.js.map