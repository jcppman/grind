import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMap, isSeq, parseDocument, stringify, type YAMLMap, type YAMLSeq } from 'yaml';
import type { ApprovalEvent } from './approvals.ts';
import type { CommandContext } from './commands.ts';
import { GrindError } from './errors.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { pathsBelow, resolveWithin, toPosix } from './paths.ts';
import { checkedGit, rejectSymlinks, validateForWrite, withStateLock } from './writes.ts';

function flowSeparator(node: YAMLMap | YAMLSeq): string {
  const token = node.srcToken;
  const last = token?.type === 'flow-collection' ? token.items.at(-1) : undefined;
  const trailingComma = last && !last.value && last.start.some((part) => part.type === 'comma');
  return node.items.length && !trailingComma ? ', ' : '';
}

export function appendApproval(raw: string, event: ApprovalEvent): string {
  const parsed = parseFrontmatter(raw);
  if (!parsed.data || parsed.error) throw new GrindError('ARTIFACT_INVALID', 'Approval requires valid typed frontmatter');
  const opening = /^\uFEFF?---\r?\n/.exec(raw)![0];
  const tail = raw.slice(opening.length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(tail)!;
  const yaml = tail.slice(0, closing.index);
  const document = parseDocument(yaml, { keepSourceTokens: true });
  if (!isMap(document.contents)) throw new GrindError('ARTIFACT_INVALID', 'Frontmatter must be a mapping');
  const newline = opening.endsWith('\r\n') ? '\r\n' : '\n';
  const grind = document.get('grind', true);
  let offset: number;
  let addition: string;
  const indentAt = (index: number) => index - (yaml.lastIndexOf('\n', index - 1) + 1);
  if (grind === undefined) {
    if (document.contents.flow) {
      offset = document.contents.range![1] - 1;
      addition = `${flowSeparator(document.contents)}grind: ${JSON.stringify({ approvals: [event] })}`;
    } else {
      offset = yaml.length;
      addition = stringify({ grind: { approvals: [event] } }).replace(/\n/g, newline);
    }
  } else {
    if (!isMap(grind)) throw new GrindError('ARTIFACT_INVALID', 'grind must be a mapping');
    const approvals = grind.get('approvals', true);
    if (approvals !== undefined) {
      if (!isSeq(approvals)) throw new GrindError('ARTIFACT_INVALID', 'grind.approvals must be a list');
      if (approvals.flow) {
        offset = approvals.range![1] - 1;
        addition = `${flowSeparator(approvals)}${JSON.stringify(event)}`;
      } else {
        offset = approvals.range![1];
        const indent = ' '.repeat(indentAt(approvals.range![0]));
        addition = stringify([event]).trimEnd().split('\n').map((line) => indent + line).join(newline) + newline;
      }
    } else if (grind.flow) {
      offset = grind.range![1] - 1;
      addition = `${flowSeparator(grind)}approvals: ${JSON.stringify([event])}`;
    } else {
      offset = grind.range![1];
      const indent = ' '.repeat(indentAt(grind.range![0]));
      addition = stringify({ approvals: [event] }).trimEnd().split('\n').map((line) => indent + line).join(newline) + newline;
    }
  }
  if (yaml.slice(yaml.lastIndexOf('\n', offset - 1) + 1, offset).trim() === '' && yaml[offset] !== undefined && /[}\]]/.test(yaml[offset]!)) {
    addition = '  ' + addition;
  }
  const updated = opening + yaml.slice(0, offset) + addition + yaml.slice(offset) + tail.slice(closing.index);
  const check = parseFrontmatter(updated);
  if (check.error) throw new GrindError('ARTIFACT_INVALID', 'Cannot append approval without damaging frontmatter');
  return updated;
}

export async function approveCommand(context: CommandContext, document: string, by?: string) {
  const { workspace } = context;
  const lexical = path.resolve(context.cwd, document);
  const relative = path.relative(workspace.initiativesDir, lexical);
  await rejectSymlinks(workspace.initiativesDir, await resolveWithin(workspace.initiativesDir, relative));
  return withStateLock(workspace, async () => {
    const target = await resolveWithin(workspace.initiativesDir, relative);
    await rejectSymlinks(workspace.initiativesDir, lexical);
    if (relative.split(path.sep).includes('_archive')) throw new GrindError('UNSUPPORTED_OPERATION', 'Archived initiatives are read-only');
    let initiative: string | undefined;
    for (const dir of pathsBelow(workspace.initiativesDir, path.dirname(target))) {
      if (await readFile(path.join(dir, 'intent.md')).then(() => true, () => false)) { initiative = dir; break; }
    }
    if (!initiative || path.basename(target) === 'index.md') throw new GrindError('ARTIFACT_INVALID', 'Select a typed document within an initiative');
    await validateForWrite(workspace, initiative);
    const root = workspace.stateGitRoot;
    const repoPath = toPosix(path.relative(root, target));
    const raw = await readFile(target, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (!parsed.data?.['type']) throw new GrindError('ARTIFACT_INVALID', 'Approval requires a typed document');
    const revision = (await checkedGit(root, 'rev-parse', 'HEAD')).trim();
    const committed = await checkedGit(root, 'show', `${revision}:${repoPath}`).catch(() => null);
    if (raw !== committed || (await checkedGit(root, 'diff', '--cached', '--name-only', '--', `:(literal)${repoPath}`)).trim()) {
      throw new GrindError('DOCUMENT_DIRTY', 'Commit the document before recording approval');
    }
    const identity = (by ?? (await checkedGit(root, 'config', 'user.name'))).trim().replace(/^human:/, '');
    if (!identity || /[\r\n]/.test(identity)) throw new GrindError('USAGE', 'Approval requires a nonempty human identity');
    const event: ApprovalEvent = { by: `human:${identity}`, at: new Date().toISOString(), revision: { commit: revision, path: repoPath } };
    const updated = appendApproval(raw, event);
    const temporary = path.join(path.dirname(target), `.grind-approval-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, updated, { flag: 'wx', mode: (await stat(target)).mode });
      if (await readFile(target, 'utf8') !== raw) {
        throw new GrindError('DOCUMENT_DIRTY', 'Document changed during approval; retry after committing it');
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    return { document: target, approval: event };
  });
}
