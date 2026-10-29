import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contextCommand, type ContextResult } from '../context.ts';
import { GrindError } from '../errors.ts';
import { parseFrontmatter } from '../frontmatter.ts';
import { NOTES_FILENAME } from '../notes.ts';
import { pathExists } from '../paths.ts';
import { resolveInitiative } from '../resolve.ts';
import type { Workspace } from '../workspace.ts';
import { sha256 } from './protocol.ts';

/** Volatile ledger metadata ignored when deciding whether shared context changed substantively. */
export const VOLATILE_LEDGER_FIELDS = ['grind.updated_at'] as const;
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];

export interface InitBinding {
  id: string;
  workspace: string;
  source: 'explicit' | 'folder' | 'branch';
}

export interface ContextArtifact {
  label: string;
  path: string;
  sha256: string;
  semanticSha256: string;
  /** Targets are hashed separately: their drift is a write conflict, not a context change. */
  target: boolean;
}

export interface ContextManifest {
  init: InitBinding | null;
  workspace: string | null;
  artifacts: ContextArtifact[];
  omissions: string[];
  readableRoots: string[];
  rawHash: string;
  semanticHash: string;
}

export interface ContextSnapshot {
  id: string;
  manifest: ContextManifest;
  bundle: string;
}

/**
 * Chooses the owning init: an explicit identifier, else the folder or checkout
 * the request came from. No init is a valid answer; ambiguity is an error.
 */
export async function resolveOwningInit(options: { workspace: Workspace | null; cwd: string; init?: string; noInit?: boolean }): Promise<InitBinding | null> {
  if (options.noInit) {
    if (options.init !== undefined) throw new GrindError('USAGE', '--init and --no-init cannot be combined');
    return null;
  }
  if (options.workspace === null) {
    if (options.init !== undefined) throw new GrindError('WORKSPACE_NOT_FOUND', `Cannot resolve init ${options.init} without a Grind workspace`);
    return null;
  }
  try {
    const resolution = await resolveInitiative({ workspace: options.workspace, cwd: options.cwd, ...(options.init === undefined ? {} : { identifier: options.init }) });
    return { id: resolution.initiative.id, workspace: options.workspace.root, source: resolution.source === 'argument' ? 'explicit' : resolution.source };
  } catch (error) {
    if (options.init === undefined && error instanceof GrindError && error.code === 'INITIATIVE_UNRESOLVED') return null;
    throw error;
  }
}

/** Removes volatile metadata so that only substantive ledger changes alter the semantic hash. */
export function semanticContent(label: string, raw: string): string {
  if (label !== 'ledger') return raw;
  const parsed = parseFrontmatter(raw);
  if (parsed.error || parsed.data === null) return raw;
  const data = structuredClone(parsed.data);
  const grind = data['grind'];
  if (grind && typeof grind === 'object' && !Array.isArray(grind)) delete (grind as Record<string, unknown>)['updated_at'];
  return `${JSON.stringify(data)}\n${parsed.body}`;
}

async function artifact(label: string, file: string, targets: ReadonlySet<string>): Promise<{ entry: ContextArtifact; text: string }> {
  const text = await readFile(file, 'utf8');
  return { entry: { label, path: file, sha256: sha256(text), semanticSha256: sha256(semanticContent(label, text)), target: targets.has(file) }, text };
}

function hashManifest(artifacts: readonly ContextArtifact[], semantic: boolean, binding: InitBinding | null, observed: unknown): string {
  const relevant = artifacts.filter((item) => !item.target).map((item) => [item.label, item.path, semantic ? item.semanticSha256 : item.sha256]);
  return sha256(JSON.stringify({ init: binding?.id ?? null, artifacts: relevant, observed }));
}

/**
 * Reads the init's intent, ledger, required constraints, linked specifications
 * and plans, repository instructions, notes and the explicit targets into one
 * snapshot that every participant receives unchanged.
 */
export async function buildSnapshot(options: { workspace: Workspace | null; cwd: string; init: InitBinding | null; targets: readonly string[] }): Promise<ContextSnapshot> {
  const targets = new Set(options.targets);
  const artifacts: ContextArtifact[] = [];
  const sections: string[] = [];
  const omissions: string[] = [];
  const readable = new Set<string>();
  let context: ContextResult | null = null;
  if (options.init !== null) {
    if (options.workspace === null) throw new GrindError('WORKSPACE_NOT_FOUND', 'Init context requires its workspace');
    context = await contextCommand({ workspace: options.workspace, cwd: options.cwd }, options.init.id);
    if (!context.complete) {
      throw new GrindError('ARTIFACT_INVALID', `Init ${options.init.id} context is incomplete; resolve its diagnostics before discussing it: ${context.diagnostics.filter((item) => item.severity === 'error').map((item) => item.message).join('; ')}`, { diagnostics: context.diagnostics });
    }
    readable.add(context.dir);
    const add = async (label: string, file: string) => {
      if (artifacts.some((item) => item.path === file)) return;
      const { entry, text } = await artifact(label, file, targets);
      artifacts.push(entry);
      sections.push(`### ${label}: ${file}\nsha256: ${entry.sha256}${entry.target ? ' (authorized target; original content)' : ''}\n\n${text}`);
    };
    await add('intent', context.intent!.path);
    await add('ledger', context.ledger!.path);
    for (const constraint of context.constraints) await add('constraint', constraint.path);
    for (const link of context.navigation) {
      if (link.external || !link.path.endsWith('.md')) continue;
      if (!(await pathExists(link.path))) {
        omissions.push(`${link.label}: ${link.path} (missing)`);
        continue;
      }
      await add(link.label.toLowerCase().includes('plan') ? 'plan' : link.label.toLowerCase().includes('spec') ? 'specification' : 'linked', await realpath(link.path));
    }
    for (const repository of context.repositories) {
      const observed = repository.observed.path;
      if (observed === null) {
        omissions.push(`repository ${repository.recorded.path} (${repository.recorded.branch}) is not checked out`);
        continue;
      }
      readable.add(observed);
      for (const name of INSTRUCTION_FILES) {
        const file = path.join(observed, name);
        if (await pathExists(file)) await add(`instructions`, await realpath(file));
      }
    }
    for (const name of INSTRUCTION_FILES) {
      const file = path.join(options.workspace.root, name);
      if (await pathExists(file)) await add('instructions', await realpath(file));
    }
    const notes = path.join(context.dir, NOTES_FILENAME);
    if (await pathExists(notes)) await add('notes', await realpath(notes));
  }
  for (const target of options.targets) {
    if (!artifacts.some((item) => item.path === target)) {
      const { entry, text } = await artifact('target', target, targets);
      artifacts.push(entry);
      sections.push(`### target: ${target}\nsha256: ${entry.sha256} (authorized target; original content)\n\n${text}`);
    }
    readable.add(path.dirname(target));
  }
  // Repository heads and omissions appear in the bundle, so they belong to the shared context too.
  const observed = { omissions, repositories: context?.repositories.map((repo) => [repo.recorded.path, repo.recorded.branch, repo.observed.path, repo.head]) ?? [] };
  const manifest: ContextManifest = {
    init: options.init,
    workspace: options.workspace?.root ?? null,
    artifacts,
    omissions,
    readableRoots: [...readable].sort(),
    rawHash: hashManifest(artifacts, false, options.init, observed),
    semanticHash: hashManifest(artifacts, true, options.init, observed),
  };
  const id = `ctx-${manifest.rawHash.slice(0, 16)}`;
  const header = options.init === null
    ? '## Owning init\n\nThis discussion has NO owning Grind init. Do not assume init objectives or constraints beyond the brief.'
    : [
      `## Owning init: ${options.init.id}`,
      `Workspace: ${options.init.workspace}\nResolved via: ${options.init.source}\nStatus: ${context!.state?.status}\nPhase: ${context!.state?.phase}\nCurrent task: ${context!.state?.current_task}\nNext action: ${context!.state?.next_action}`,
      `Repositories:\n${context!.repositories.map((repo) => `- ${repo.recorded.path} @ ${repo.recorded.branch}: ${repo.observed.path ?? 'not checked out'} (head ${repo.head ?? 'unknown'})`).join('\n') || '- none recorded'}`,
      `Review notes (${context!.notes.length}):\n${context!.notes.map((note) => `- ${JSON.stringify(note)}`).join('\n') || '- none'}`,
    ].join('\n\n');
  const bundle = [
    `# Grind discussion context snapshot ${id}`,
    header,
    `Omissions:\n${omissions.map((item) => `- ${item}`).join('\n') || '- none'}`,
    `Readable source roots (read-only):\n${manifest.readableRoots.map((root) => `- ${root}`).join('\n') || '- none'}`,
    '## Artifacts',
    ...sections,
  ].join('\n\n');
  return { id, manifest, bundle };
}

export async function writeSnapshot(dir: string, snapshot: ContextSnapshot): Promise<string> {
  const target = path.join(dir, 'context', snapshot.id);
  await mkdir(target, { recursive: true, mode: 0o700 });
  await writeFile(path.join(target, 'bundle.md'), `${snapshot.bundle}\n`, { mode: 0o600 });
  await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(snapshot.manifest, null, 2)}\n`, { mode: 0o600 });
  return target;
}

export interface DriftReport {
  kind: 'none' | 'metadata' | 'substantive';
  changed: string[];
}

export function compareSnapshots(previous: ContextManifest, current: ContextManifest): DriftReport {
  if (previous.rawHash === current.rawHash) return { kind: 'none', changed: [] };
  const before = new Map(previous.artifacts.map((item) => [item.path, item]));
  const changed = current.artifacts.filter((item) => !item.target && before.get(item.path)?.sha256 !== item.sha256).map((item) => item.path);
  const removed = previous.artifacts.filter((item) => !item.target && !current.artifacts.some((other) => other.path === item.path)).map((item) => item.path);
  return { kind: previous.semanticHash === current.semanticHash ? 'metadata' : 'substantive', changed: [...changed, ...removed] };
}
