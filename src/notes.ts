import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.ts';
import { locateBranch, repositoryCheckout } from './checkouts.ts';
import type { CommandContext } from './commands.ts';
import type { InitiativeEntry } from './discovery.ts';
import { GrindError } from './errors.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { atomicWriteFile } from './operations.ts';
import { isContainedRelativePath, normalizeRepositoryPath, toPosix } from './paths.ts';
import { branchOwners, resolveIdentifierOrFragment, resolveInitiative, tracksPath } from './resolve.ts';
import { withStateLock } from './writes.ts';

export const NOTES_FILENAME = 'notes.md';
const NOTES_TEMPLATE = '---\ntype: Review Notes\n---\n\n# Review notes\n';
const NOTE_HEADING = /^## (n\d+) @(\S+?):(.+)#(\d+)(?:-(\d+))?\s*$/;
const SECTION_HEADING = /^#{1,2} /;

export interface ReviewNote {
  id: string;
  repository: string;
  path: string;
  start: number;
  end: number;
  /** First line of the range when the note was written, or null. */
  anchor: string | null;
  body: string;
}

interface NoteBlock {
  note: ReviewNote;
  /** Character offsets of the block within the file. */
  from: number;
  to: number;
}

function notesPath(dir: string): string {
  return path.join(dir, NOTES_FILENAME);
}

async function readRaw(dir: string): Promise<string | null> {
  return readFile(notesPath(dir), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

function parseBlocks(raw: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const bodyStart = raw.length - parseFrontmatter(raw).body.length;
  let current: { heading: RegExpExecArray; from: number; lines: string[] } | null = null;
  const flush = (to: number): void => {
    if (current === null) return;
    const [, id, repository, notePath, start, end] = current.heading;
    const content = [...current.lines];
    while (content[0]?.trim() === '') content.shift();
    const anchor = content[0]?.startsWith('>') ? (content.shift() as string).replace(/^>\s?/, '') : null;
    blocks.push({
      note: {
        id: id as string,
        repository: repository as string,
        path: notePath as string,
        start: Number(start),
        end: Number(end ?? start),
        anchor,
        body: content.join('\n').trim(),
      },
      from: current.from,
      to,
    });
    current = null;
  };
  let offset = 0;
  for (const line of raw.split('\n')) {
    const from = offset;
    offset += line.length + 1;
    if (from < bodyStart) continue;
    const heading = NOTE_HEADING.exec(line);
    if (heading !== null || SECTION_HEADING.test(line)) flush(from);
    if (heading !== null) current = { heading, from, lines: [] };
    else current?.lines.push(line);
  }
  flush(raw.length);
  return blocks;
}

/** Review notes recorded for the initiative in `dir`. */
export async function readNotes(dir: string): Promise<ReviewNote[]> {
  const raw = await readRaw(dir);
  return raw === null ? [] : parseBlocks(raw).map((block) => block.note);
}

function nextId(notes: readonly ReviewNote[]): string {
  return `n${notes.reduce((max, note) => Math.max(max, Number(note.id.slice(1))), 0) + 1}`;
}

export interface AddNoteInput {
  file: string;
  start: number;
  end: number;
  comment: string;
  initiative?: string;
}

export interface AddNoteResult {
  id: string;
  initiative: string;
  reference: string;
  notes: string;
}

/** Records a review note with the initiative owning the file's branch, or the given initiative. */
export async function addNote(context: CommandContext, input: AddNoteInput): Promise<AddNoteResult> {
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 1 || input.end < input.start) {
    throw new GrindError('NOTE_INVALID', 'Line range must use positive integers with end greater than or equal to start');
  }
  const comment = input.comment.trim();
  if (comment === '') throw new GrindError('NOTE_INVALID', 'Comment must not be empty');
  if (comment.split(/\r?\n/).some((line) => SECTION_HEADING.test(line))) {
    throw new GrindError('NOTE_INVALID', 'Comment cannot contain a level-one or level-two Markdown heading');
  }
  const file = await realpath(path.resolve(context.cwd, input.file)).catch(() => null);
  if (file === null) throw new GrindError('NOTE_INVALID', `File does not exist: ${input.file}`);
  const checkout = await repositoryCheckout(context.workspace, path.dirname(file));
  if (checkout === null) throw new GrindError('NOTE_INVALID', `File is not inside a repository of workspace ${context.workspace.root}: ${input.file}`);
  const relative = toPosix(path.relative(checkout.root, file));
  if (!isContainedRelativePath(relative)) throw new GrindError('PATH_ESCAPE', `File resolves outside its Git repository: ${input.file}`);
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  if (input.end > lines.length || (input.end === lines.length && lines.at(-1) === '')) {
    throw new GrindError('NOTE_INVALID', `Line range ${input.start}-${input.end} exceeds ${relative}`);
  }
  const entry = await noteOwner(context, checkout.repositoryPath, checkout.branch, input.initiative);
  if (entry.archived) throw new GrindError('UNSUPPORTED_OPERATION', 'Archived initiatives are read-only');
  const range = `${input.start}${input.end === input.start ? '' : `-${input.end}`}`;
  return withStateLock(context.workspace, async () => {
    const raw = (await readRaw(entry.dir)) ?? NOTES_TEMPLATE;
    const id = nextId(parseBlocks(raw).map((block) => block.note));
    const reference = `@${checkout.repositoryPath}:${relative}#${range}`;
    const separator = raw.endsWith('\n\n') ? '' : raw.endsWith('\n') ? '\n' : '\n\n';
    const block = `## ${id} ${reference}\n> ${lines[input.start - 1] as string}\n\n${comment}\n`;
    await atomicWriteFile(notesPath(entry.dir), `${raw}${separator}${block}`);
    return { id, initiative: entry.id, reference, notes: notesPath(entry.dir) };
  });
}

async function noteOwner(context: CommandContext, repositoryPath: string, branch: string | null, override?: string): Promise<InitiativeEntry> {
  if (override !== undefined) return resolveIdentifierOrFragment(context.workspace, override);
  const owners = branch === null ? [] : await branchOwners(context.workspace, repositoryPath, branch);
  if (owners.length === 1) return owners[0] as InitiativeEntry;
  throw new GrindError(
    owners.length === 0 ? 'INITIATIVE_UNRESOLVED' : 'INITIATIVE_AMBIGUOUS',
    owners.length === 0
      ? `No open initiative owns ${branch === null ? 'a detached HEAD' : `branch ${branch}`} of ${repositoryPath}; pass --init`
      : `Branch ${branch} of ${repositoryPath} is owned by several initiatives (${owners.map((owner) => owner.id).join(', ')}); pass --init`,
    { repository: repositoryPath, branch, candidates: owners.map((owner) => owner.id) },
  );
}

export interface ListedNote extends ReviewNote {
  /** Absolute path of the file in the checkout currently holding the initiative's branch, or null. */
  file: string | null;
}

export async function listNotes(context: CommandContext, identifier?: string): Promise<{ initiative: string; notes: ListedNote[] }> {
  const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
  const record = await readInitiative(initiative.dir, { workspace: context.workspace });
  const repositories = record.ledgerState?.state?.repositories ?? [];
  const notes: ListedNote[] = [];
  for (const note of await readNotes(initiative.dir)) {
    const recorded = repositories.find((repository) => tracksPath(repository, note.repository));
    let file: string | null = null;
    if (recorded !== undefined) {
      const canonical = path.resolve(context.workspace.root, normalizeRepositoryPath(recorded.path));
      const location = await locateBranch(context.workspace, canonical, recorded.branch).catch(() => null);
      if (location?.path) file = path.join(location.path, ...note.path.split('/'));
    }
    notes.push({ ...note, file });
  }
  return { initiative: initiative.id, notes };
}

/** Removes a resolved note; its history stays in the state repository. */
export async function resolveNote(context: CommandContext, id: string, identifier?: string): Promise<{ initiative: string; id: string }> {
  const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
  return withStateLock(context.workspace, async () => {
    const raw = await readRaw(initiative.dir);
    const block = raw === null ? undefined : parseBlocks(raw).find((item) => item.note.id === id);
    if (raw === null || block === undefined) throw new GrindError('NOTE_INVALID', `${initiative.id} has no note ${id}`, { initiative: initiative.id, id });
    await atomicWriteFile(notesPath(initiative.dir), `${raw.slice(0, block.from)}${raw.slice(block.to)}`);
    return { initiative: initiative.id, id };
  });
}
