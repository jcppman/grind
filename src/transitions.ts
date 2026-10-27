import { stringify } from 'yaml';
import { GrindError } from './errors.ts';
import { isRecord, parseFrontmatter } from './frontmatter.ts';

export interface CloseInput {
  outcome: 'delivered' | 'abandoned';
  result: string;
  date: string;
  updatedAt: string;
}

function ledgerParts(raw: string): { data: Record<string, unknown>; grind: Record<string, unknown>; body: string } {
  const parsed = parseFrontmatter(raw);
  if (parsed.error !== undefined || parsed.data === null || !isRecord(parsed.data['grind'])) {
    throw new GrindError('ARTIFACT_INVALID', parsed.error ?? 'Ledger requires a grind mapping');
  }
  return { data: { ...parsed.data }, grind: { ...parsed.data['grind'] }, body: parsed.body };
}

function render(data: Record<string, unknown>, grind: Record<string, unknown>, body: string): string {
  return `---\n${stringify({ ...data, grind })}---\n${body}`;
}

function appendHistory(body: string, entry: string): string {
  const heading = body.includes('\n## Lifecycle history\n') || body.startsWith('## Lifecycle history\n')
    ? ''
    : `${body === '' || body.endsWith('\n') ? '' : '\n'}\n## Lifecycle history\n`;
  return `${body}${heading}\n${entry.trim()}\n`;
}

export function assertVerification(grind: Record<string, unknown>, outcome: CloseInput['outcome']): void {
  for (const key of ['need_verify', 'verified']) {
    if (key in grind && typeof grind[key] !== 'boolean') {
      throw new GrindError('ARTIFACT_INVALID', `grind.${key} must be a boolean`);
    }
  }
  if (outcome === 'delivered' && grind['need_verify'] === true && grind['verified'] !== true) {
    throw new GrindError('VERIFICATION_REQUIRED', 'Local verification by the user is required before delivered closure; record their explicit confirmation in grind.verified');
  }
}

export function closeLedger(raw: string, input: CloseInput): string {
  const { data, grind, body } = ledgerParts(raw);
  if (grind['status'] !== 'open') throw new GrindError('UNSUPPORTED_OPERATION', 'Only an open initiative can be closed');
  assertVerification(grind, input.outcome);
  for (const key of ['phase', 'current_task', 'next_action']) {
    if (typeof grind[key] !== 'string' || (grind[key] as string).trim() === '') {
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
