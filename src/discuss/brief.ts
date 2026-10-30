import type { InitBinding } from './context.ts';
import { latestCandidate, PROPOSAL_TARGET, type ProtocolState, type Turn } from './protocol.ts';

export interface BriefInput {
  state: ProtocolState;
  turn: Turn;
  brief: string;
  init: InitBinding | null;
  participant: { id: string; role: string; instructions: string; engine: string };
  writer: string;
  bundle: string;
  bundlePath: string;
  readableRoots: readonly string[];
}

function bootstrap(input: BriefInput): string {
  const { state, turn, participant, init } = input;
  return [
    '# Grind discussion turn',
    'You are one participant in a bounded Grind discussion. Grind schedules every turn; you answer only this turn and then stop.',
    `- Discussion: ${state.discussionId}`,
    `- Owning init: ${init === null ? 'NONE (general discussion; no init objectives apply)' : `${init.id} (workspace ${init.workspace})`}`,
    `- Your participant ID: ${participant.id}`,
    `- Your role: ${participant.role} — ${participant.instructions}`,
    `- Writer: ${input.writer}${input.writer === participant.id ? ' (you)' : ''}. Only the writer drafts candidate text; only Grind applies an accepted candidate.`,
    `- Turn: ${turn.id}, phase ${turn.kind}, revision ${turn.revision ?? 'none'}, context snapshot ${turn.snapshotId}`,
    `- Authorized document targets: ${state.targets.join(', ')}${state.targets[0] === PROPOSAL_TARGET ? ' (no file will be changed; the proposal is returned to the user)' : ''}`,
    '',
    '## Rules',
    '- Read-only: do not create, edit or delete files, and do not try to work around tool or sandbox refusals.',
    '- Do not run Grind lifecycle commands (start, save, close, switch, create, note, worktree, discuss) or any other command that changes state.',
    '- Do not spawn agents, message other sessions or use cmux. Peers see your answer only through Grind.',
    '- Ground claims in the context snapshot and the readable source roots. Cite evidence as file paths with line numbers or section names.',
    '- Distinguish an objection (the candidate is wrong or incomplete), an evidence_request (you need specific evidence first) and a user_question (only the user can decide). Do not invent agreement or disagreement you do not hold.',
    '- Agreement is not permission to implement; never claim work was done.',
    `- Readable source roots: ${input.readableRoots.join(', ') || 'none'}`,
  ].join('\n');
}

function contract(input: BriefInput): string {
  const { state, turn, participant } = input;
  const echo = { discussionId: state.discussionId, participant: participant.id, turnId: turn.id, phase: turn.kind, revision: turn.revision, snapshotId: turn.snapshotId, ...(turn.kind === 'ratify' ? { candidateHash: turn.candidateHash } : {}) };
  return [
    '## Result contract',
    'Finish with ONLY one JSON object matching the provided schema. Copy these fields exactly:',
    JSON.stringify(echo),
  ].join('\n');
}

function task(input: BriefInput): string {
  const { state, turn } = input;
  const inputs = state.incorporatedInput.map((item) => `- (${item.receivedAt}) ${item.text}`).join('\n');
  const userInput = inputs ? `\n\n## User input so far\n${inputs}` : '';
  if (turn.kind === 'assess') {
    return `## Task: independent assessment\nInvestigate the brief on your own before seeing any peer conclusion. Return a short summary and findings (kind finding, objection, evidence_request or user_question) with evidence.${userInput}`;
  }
  const candidate = latestCandidate(state);
  if (turn.kind === 'draft') {
    const assessments = Object.entries(state.assessments).map(([id, a]) => `### ${id}\n${a.summary}\n${JSON.stringify(a.findings, null, 2)}`).join('\n\n');
    const previous = candidate === null ? '' : `\n\n## Previous candidate revision ${candidate.revision} (hash ${candidate.hash})\n${JSON.stringify({ documents: candidate.documents, assumptions: candidate.assumptions }, null, 2)}\n\n## Open issues on it\n${JSON.stringify(state.openIssues, null, 2)}`;
    return [
      `## Task: write candidate revision ${turn.revision}`,
      `Write the complete text of every target (${state.targets.join(', ')}), never a diff. List assumptions and give a disposition (accepted, rejected or deferred, with rationale) for every substantive objection or question raised so far.`,
      `## Independent assessments\n${assessments}`,
    ].join('\n\n') + previous + userInput;
  }
  return [
    `## Task: ratify candidate revision ${turn.revision}`,
    `Accept only if you would accept these exact documents and assumptions (candidate hash ${turn.candidateHash}). Writing a candidate does not imply accepting it. Otherwise object and list each objection, evidence request or user question.`,
    `## Candidate\n${JSON.stringify(candidate === null ? null : { documents: candidate.documents, assumptions: candidate.assumptions, dispositions: candidate.dispositions, summary: candidate.summary }, null, 2)}`,
  ].join('\n\n') + userInput;
}

/** The full prompt for one turn: protocol bootstrap and shared snapshot are re-supplied every time. */
export function composeBrief(input: BriefInput): string {
  return [
    bootstrap(input),
    `## Brief from the user\n${input.brief}`,
    task(input),
    `## Shared context snapshot ${input.turn.snapshotId} (also at ${input.bundlePath})\n\n${input.bundle}`,
    contract(input),
  ].join('\n\n');
}
