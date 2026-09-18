import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { diagnostic, type Diagnostic } from './errors.ts';
import { getString, parseFrontmatter } from './frontmatter.ts';

export const SIDECAR_FILENAME = '.grind.md';

export interface SidecarNote {
  /** The `@path#start-end` reference as written. */
  reference: string;
  path: string;
  start: number;
  end: number;
  /** First line of the range when the note was written, or null. */
  anchor: string | null;
  body: string;
}

export interface Sidecar {
  path: string;
  raw: string;
  body: string;
  /** Initiative path relative to `initiatives/`, or null when the pointer is absent. */
  initiative: string | null;
  notes: SidecarNote[];
  diagnostics: Diagnostic[];
}

const NOTE_HEADING = /^## (@(.+?)#(\d+)(?:-(\d+))?)\s*$/;

/** Reads the checkout's sidecar, or returns null when there is none. */
export async function readSidecar(checkoutRoot: string): Promise<Sidecar | null> {
  const sidecarPath = path.join(checkoutRoot, SIDECAR_FILENAME);
  let raw: string;
  try {
    raw = await readFile(sidecarPath, 'utf8');
  } catch {
    return null;
  }
  return parseSidecar(raw, sidecarPath);
}

export function parseSidecar(raw: string, sidecarPath: string): Sidecar {
  const diagnostics: Diagnostic[] = [];
  const frontmatter = parseFrontmatter(raw);
  let initiative: string | null = null;
  if (frontmatter.error !== undefined) {
    diagnostics.push(diagnostic('error', 'SIDECAR_INVALID', frontmatter.error, sidecarPath));
  } else if (frontmatter.data !== null) {
    initiative = getString(frontmatter.data, 'initiative');
    if ('initiative' in frontmatter.data && initiative === null) {
      diagnostics.push(
        diagnostic('error', 'SIDECAR_INVALID', '`initiative` must be a nonempty string', sidecarPath),
      );
    }
  }
  return { path: sidecarPath, raw, body: frontmatter.body, initiative, notes: parseNotes(frontmatter.body), diagnostics };
}

/** Rewrites only the pointer mapping while preserving the Markdown body. */
export function renderSidecar(raw: string, initiative: string | null, body?: string): string {
  const frontmatter = parseFrontmatter(raw);
  if (frontmatter.error !== undefined || frontmatter.data === null && frontmatter.hasFrontmatter) {
    throw new Error(frontmatter.error ?? 'Invalid sidecar frontmatter');
  }
  const data = { ...(frontmatter.data ?? {}) };
  if (initiative === null) delete data['initiative'];
  else data['initiative'] = initiative;
  const nextBody = body ?? frontmatter.body;
  if (Object.keys(data).length === 0) return nextBody;
  return `---\n${stringify(data)}---\n${nextBody}`;
}

function parseNotes(body: string): SidecarNote[] {
  const notes: SidecarNote[] = [];
  let current: { heading: RegExpExecArray; lines: string[] } | null = null;
  const flush = (): void => {
    if (!current) return;
    const [, reference, notePath, start, end] = current.heading;
    const lines = [...current.lines];
    while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
    let anchor: string | null = null;
    if (lines[0]?.startsWith('>')) {
      anchor = (lines.shift() as string).replace(/^>\s?/, '');
    }
    notes.push({
      reference: reference as string,
      path: notePath as string,
      start: Number(start),
      end: Number(end ?? start),
      anchor,
      body: lines.join('\n').trim(),
    });
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = NOTE_HEADING.exec(line);
    if (heading) {
      flush();
      current = { heading, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return notes;
}
