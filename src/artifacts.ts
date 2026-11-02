import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readRoadmaps, resolveRoadmap, type RoadmapCatalog, type RoadmapDocument } from './roadmaps.ts';
import { navigation } from './context-markdown.ts';
import { diagnostic, type Diagnostic } from './errors.ts';
import { getString, isRecord, parseFrontmatter, type Frontmatter } from './frontmatter.ts';
import { LEDGER_TYPE, validateLedger, type LedgerValidation } from './ledger.ts';
import { pathExists, toPosix } from './paths.ts';
import type { Workspace } from './workspace.ts';

export const INTENT_TYPE = 'Intent';
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
  roadmap: RoadmapDocument | null;
  roadmaps: RoadmapDocument[];
  diagnostics: Diagnostic[];
}

export interface ReadInitiativeOptions {
  /** Enables roadmap resolution from the workspace's state directory. */
  workspace?: Workspace;
  roadmapCatalog?: RoadmapCatalog;
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
    ? validateLedger(ledger.frontmatter, ledger.path)
    : null;
  if (ledgerState) diagnostics.push(...ledgerState.diagnostics);
  for (const doc of documents) {
    if (doc.role === 'index') diagnostics.push(...(await checkIndexLinks(doc)));
  }
  const catalog = options.roadmapCatalog ?? (options.workspace ? await readRoadmaps(options.workspace.stateDir) : null);
  const roadmaps: RoadmapDocument[] = [];
  let roadmap: RoadmapDocument | null = null;
  if (catalog) {
    diagnostics.push(...catalog.diagnostics.filter(item => documents.some(doc => doc.path === item.path)));
    for (const doc of documents) {
      const resolved = resolveRoadmap(doc.frontmatter, doc.path, catalog, diagnostics);
      if (doc.role === 'intent') roadmap = resolved;
      if (resolved && !roadmaps.some(existing => existing.id === resolved.id)) roadmaps.push(resolved);
    }
  }
  return {
    dir,
    roadmap,
    roadmaps,
    documents,
    index: byRelative('index.md'),
    intent: byRelative('intent.md'),
    ledger,
    ledgerState,
    diagnostics,
  };
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
    if (frontmatter.hasFrontmatter && frontmatter.data && !validIndexMetadata(frontmatter.data)) {
      diagnostics.push(
        diagnostic('warning', 'INDEX_FRONTMATTER', 'Indexes allow only `okf_version` and `grind.roadmap` frontmatter', file),
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
  const grind = frontmatter.data?.['grind'];
  const root = isRecord(grind) ? grind['root'] : undefined;
  if (role === 'intent' && root !== true) {
    diagnostics.push(diagnostic('error', 'ROOT_REQUIRED', 'Initiative intent must declare grind.root: true', file));
  } else if (role !== 'intent' && root === true) {
    diagnostics.push(diagnostic('error', 'NESTED_ROOT', 'Only the initiative root intent may declare grind.root: true', file));
  }
  if (root !== undefined && typeof root !== 'boolean') {
    diagnostics.push(diagnostic('error', 'ROOT_INVALID', 'grind.root must be a boolean', file));
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

function validIndexMetadata(data: Record<string, unknown>): boolean {
  return Object.keys(data).every(key => key === 'okf_version' ||
    (key === 'grind' && isRecord(data[key]) && Object.keys(data[key]).every(field => field === 'roadmap')));
}

/** Local links in an index must resolve so navigation never points at a missing document. */
async function checkIndexLinks(doc: ArtifactDocument): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  try {
    for (const link of navigation(doc.frontmatter.body, doc.path)) {
      if (!link.external && !(await pathExists(link.path))) {
        diagnostics.push(diagnostic('error', 'BROKEN_LINK', `Index link "${link.path}" does not resolve`, doc.path));
      }
    }
  } catch (error) {
    diagnostics.push(diagnostic('error', 'BROKEN_LINK', (error as Error).message, doc.path));
  }
  return diagnostics;
}
