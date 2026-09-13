import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnostic, type Diagnostic } from './errors.ts';
import { getString, parseFrontmatter, type Frontmatter } from './frontmatter.ts';
import { LEDGER_TYPE, validateLedger, type LedgerValidation } from './ledger.ts';
import { pathExists, toPosix } from './paths.ts';
import type { Workspace } from './workspace.ts';

export const INTENT_TYPE = 'Initiative Intent';
export const REQUIRED_ARTIFACTS = ['index.md', 'intent.md', 'ledger.md'] as const;

export type ArtifactRole = 'index' | 'intent' | 'ledger' | 'document';

export interface ArtifactDocument {
  path: string;
  /** Path relative to the initiative folder, using forward slashes. */
  relativePath: string;
  role: ArtifactRole;
  /** Frontmatter `type`, or null when absent or empty. */
  type: string | null;
  frontmatter: Frontmatter;
}

export interface InitiativeRecord {
  dir: string;
  documents: ArtifactDocument[];
  index: ArtifactDocument | null;
  intent: ArtifactDocument | null;
  ledger: ArtifactDocument | null;
  ledgerState: LedgerValidation | null;
  diagnostics: Diagnostic[];
}

export interface ReadInitiativeOptions {
  /** Enables checks that need workspace geometry, such as worktrees inside the state directory. */
  workspace?: Workspace;
}

/** Reads every Markdown artifact of an initiative without modifying anything. */
export async function readInitiative(
  dir: string,
  options: ReadInitiativeOptions = {},
): Promise<InitiativeRecord> {
  const diagnostics: Diagnostic[] = [];
  const files = await collectMarkdown(dir, diagnostics);
  const documents: ArtifactDocument[] = [];
  for (const file of files) {
    documents.push(await readDocument(dir, file, diagnostics));
  }
  for (const required of REQUIRED_ARTIFACTS) {
    if (!files.includes(path.join(dir, required))) {
      diagnostics.push(
        diagnostic('error', 'MISSING_ARTIFACT', `Required artifact ${required} is missing`, path.join(dir, required)),
      );
    }
  }
  const byRelative = (relative: string): ArtifactDocument | null =>
    documents.find((d) => d.relativePath === relative) ?? null;
  const ledger = byRelative('ledger.md');
  const ledgerState = ledger
    ? validateLedger(ledger.frontmatter, ledger.path, {
        statePathFromWorkspace: statePathFromWorkspace(options.workspace),
      })
    : null;
  if (ledgerState) diagnostics.push(...ledgerState.diagnostics);
  for (const doc of documents) {
    if (doc.role === 'index') diagnostics.push(...(await checkIndexLinks(doc)));
  }
  return {
    dir,
    documents,
    index: byRelative('index.md'),
    intent: byRelative('intent.md'),
    ledger,
    ledgerState,
    diagnostics,
  };
}

/** Workspace-relative state directory, or null when the state lives outside the workspace. */
function statePathFromWorkspace(workspace: Workspace | undefined): string | null {
  if (!workspace) return null;
  const relative = path.relative(workspace.root, workspace.stateDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return toPosix(relative);
}

async function collectMarkdown(dir: string, diagnostics: Diagnostic[]): Promise<string[]> {
  const result: string[] = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      diagnostics.push(
        diagnostic('error', 'SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed beneath initiatives/', full),
      );
    } else if (info.isDirectory()) {
      result.push(...(await collectMarkdown(full, diagnostics)));
    } else if (info.isFile() && name.endsWith('.md')) {
      result.push(full);
    }
  }
  return result.sort();
}

async function readDocument(
  dir: string,
  file: string,
  diagnostics: Diagnostic[],
): Promise<ArtifactDocument> {
  const relativePath = toPosix(path.relative(dir, file));
  const frontmatter = parseFrontmatter(await readFile(file, 'utf8'));
  const role = roleOf(relativePath);
  const type = frontmatter.data ? getString(frontmatter.data, 'type') : null;
  if (frontmatter.error !== undefined) {
    diagnostics.push(diagnostic('error', 'FRONTMATTER_INVALID', frontmatter.error, file));
  }
  if (role === 'index') {
    if (frontmatter.hasFrontmatter && frontmatter.data && !onlyOkfVersion(frontmatter.data)) {
      diagnostics.push(
        diagnostic('warning', 'INDEX_FRONTMATTER', 'Indexes carry no frontmatter beyond `okf_version`', file),
      );
    }
  } else if (role !== 'ledger' || frontmatter.hasFrontmatter) {
    if (!frontmatter.hasFrontmatter) {
      diagnostics.push(
        diagnostic('warning', 'LEGACY_RECORD', 'Artifact has no frontmatter; migrate it explicitly', file),
      );
    } else if (type === null && frontmatter.error === undefined) {
      diagnostics.push(
        diagnostic('error', 'MISSING_TYPE', 'Artifact frontmatter requires a nonempty string `type`', file),
      );
    }
  }
  const expected = role === 'intent' ? INTENT_TYPE : role === 'ledger' ? LEDGER_TYPE : null;
  if (expected !== null && type !== null && type !== expected) {
    diagnostics.push(
      diagnostic('warning', 'TYPE_MISMATCH', `Expected type "${expected}" but found "${type}"`, file),
    );
  }
  return { path: file, relativePath, role, type, frontmatter };
}

function roleOf(relativePath: string): ArtifactRole {
  if (relativePath === 'intent.md') return 'intent';
  if (relativePath === 'ledger.md') return 'ledger';
  if (path.posix.basename(relativePath) === 'index.md') return 'index';
  return 'document';
}

function onlyOkfVersion(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  return keys.length === 0 || (keys.length === 1 && keys[0] === 'okf_version');
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Local links in an index must resolve so navigation never points at a missing document. */
async function checkIndexLinks(doc: ArtifactDocument): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const match of doc.frontmatter.body.matchAll(MARKDOWN_LINK)) {
    const target = match[1] as string;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const withoutFragment = target.split('#')[0] as string;
    if (withoutFragment === '') continue;
    const resolved = path.resolve(path.dirname(doc.path), decodeURI(withoutFragment));
    if (!(await pathExists(resolved))) {
      diagnostics.push(
        diagnostic('error', 'BROKEN_LINK', `Index link "${target}" does not resolve`, doc.path),
      );
    }
  }
  return diagnostics;
}
