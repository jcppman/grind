import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative, type ArtifactDocument } from './artifacts.ts';
import type { CommandContext } from './commands.ts';
import { markdownSection, navigation, requiredLinks, resolveLink, type ContextLink } from './context-markdown.ts';
import { diagnostic, hasErrors, type Diagnostic } from './errors.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { checkoutKind, repositoryCheckout } from './checkouts.ts';
import { git } from './git.ts';
import { inspectInitiative } from './inspect.ts';
import { readNotes } from './notes.ts';
import { pendingOperationSummaries } from './operations.ts';
import { branchOwners, resolveInitiative } from './resolve.ts';
import type { Workspace } from './workspace.ts';

export const ENTRY_RULES = [
  'The user’s current request determines the task; the recorded next action is only a candidate.',
  'Context loading is read-only: do not fetch, create worktrees, switch branches, reopen, handle notes, or save as part of loading.',
  'Look up the working path with grind worktree before changing code, and again after any pause; never change the branch of the user’s canonical checkout unless asked.',
  'Inspect pending review notes before resuming implementation.',
  'Load the relevant specification and plan before changing behavior.',
  'Checkpoint meaningful work through the save workflow. Load operation-specific skills when needed.',
];

export interface ContextSource {
  path: string;
  fragment: string | null;
  body: string;
  metadata: Record<string, unknown> | null;
}

function source(doc: ArtifactDocument | null): ContextSource | null {
  return doc ? { path: doc.path, fragment: null, body: doc.frontmatter.body, metadata: doc.frontmatter.data } : null;
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function head(dir: string): Promise<string | null> {
  const result = await git(['rev-parse', '--verify', 'HEAD'], dir);
  return result.ok ? result.stdout.trim() : null;
}

async function invokingCheckoutDetails(workspace: Workspace, cwd: string) {
  const checkout = await repositoryCheckout(workspace, cwd);
  if (checkout === null) return null;
  const owners = checkout.branch === null ? [] : await branchOwners(workspace, checkout.repositoryPath, checkout.branch);
  return {
    path: checkout.root,
    repository: checkout.repositoryPath,
    kind: checkoutKind(workspace, checkout.canonical, checkout.root),
    branch: checkout.branch,
    head: await head(checkout.root),
    owners: owners.map((owner) => owner.id),
  };
}

export async function contextCommand(context: CommandContext, identifier?: string) {
  const resolution = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
  const record = await readInitiative(resolution.initiative.dir, { workspace: context.workspace });
  const inspection = await inspectInitiative(context.workspace, resolution.initiative, record);
  const diagnostics: Diagnostic[] = [...resolution.diagnostics, ...inspection.diagnostics];
  const intent = source(record.intent);
  const ledger = source(record.ledger);
  const constraints: ContextSource[] = [];
  const seen = new Set([intent?.path, ledger?.path].filter(Boolean).map(file => `${file}#`));
  let links: ContextLink[] = [];
  if (record.index) {
    try { links = navigation(record.index.frontmatter.body, record.index.path); }
    catch (error) { diagnostics.push(diagnostic('error', 'CONTEXT_LINK_INVALID', (error as Error).message, record.index.path)); }
    let required: string[] = [];
    try { required = requiredLinks(record.index.frontmatter.body); }
    catch (error) { diagnostics.push(diagnostic('error', 'CONTEXT_REQUIRED_INVALID', (error as Error).message, record.index.path)); }
    for (const href of required) {
      try {
        const link = resolveLink(href, record.index.path);
        if (link.external) throw new Error(`Required read must be local Markdown: ${href}`);
        const file = await realpath(link.path);
        if (![context.workspace.root, context.workspace.stateDir].some(root => contained(root, file))) {
          throw new Error(`Required read is outside workspace and state roots: ${href}`);
        }
        if (!file.endsWith('.md')) throw new Error(`Required read must be Markdown: ${href}`);
        const key = `${file}#${link.fragment ?? ''}`;
        const doc = record.documents.find(doc => doc.path === file);
        const parsed = doc?.frontmatter ?? parseFrontmatter(await readFile(file, 'utf8'));
        if (parsed.error) throw new Error(parsed.error);
        const body = link.fragment === null ? parsed.body : markdownSection(parsed.body, link.fragment);
        if (seen.has(key) || seen.has(`${file}#`)) continue;
        constraints.push({ path: file, fragment: link.fragment, body, metadata: parsed.data });
        seen.add(key);
      } catch (error) {
        diagnostics.push(diagnostic('error', 'CONTEXT_REQUIRED_INVALID', `${href}: ${(error as Error).message}`, record.index.path));
      }
    }
  }
  const repositories = [];
  for (const repository of [...inspection.repositories].sort((a, b) => a.recorded.path.localeCompare(b.recorded.path))) {
    repositories.push({ ...repository, head: repository.observed.path === null ? null : await head(repository.observed.path) });
  }
  const invokingCheckout = await invokingCheckoutDetails(context.workspace, context.cwd);
  if (invokingCheckout && invokingCheckout.owners.length > 0 && !invokingCheckout.owners.includes(inspection.id)) {
    diagnostics.push(diagnostic('warning', 'INVOKING_CHECKOUT_ASSOCIATION', `Invoking checkout is on a branch of ${invokingCheckout.owners.join(', ')}; selected init is ${inspection.id}.`, invokingCheckout.path));
  }
  const notes = await readNotes(inspection.dir);
  const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter(op => op.target === inspection.id || `_archive/${op.target}` === inspection.id);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspace: context.workspace.root,
    id: inspection.id,
    dir: inspection.dir,
    archived: inspection.archived,
    resolution: { source: resolution.source },
    state: inspection.state,
    complete: Boolean(intent && ledger && record.index && inspection.state) && !hasErrors(diagnostics),
    roadmap: inspection.roadmap,
    roadmaps: record.roadmaps,
    intent, constraints, ledger, repositories, notes, invokingCheckout, pendingOperations,
    diagnostics, navigation: links, entryRules: ENTRY_RULES,
  };
}

export type ContextResult = Awaited<ReturnType<typeof contextCommand>>;

function renderSource(doc: ContextSource | null): string {
  if (!doc) return 'Missing required source.';
  return `Source: ${doc.path}${doc.fragment === null ? '' : `#${doc.fragment}`}\nMetadata: ${JSON.stringify(doc.metadata)}\n\n${doc.body}`;
}

export function formatContext(result: ContextResult): string {
  return [
    `# Init context: ${result.id}`,
    `Folder: ${result.dir}\nWorkspace: ${result.workspace}\nStatus: ${result.state?.status ?? 'malformed'}${result.archived ? ' (archived)' : ''}\nResolved via: ${result.resolution.source}\nCaptured: ${result.generatedAt}\nComplete: ${result.complete ? 'yes' : 'NO — resolve diagnostics before substantive work'}`,
    '## Purpose and constraints', renderSource(result.intent), ...result.constraints.map(renderSource),
    '## Roadmaps (planning context)', ...result.roadmaps.map(doc => renderSource({ ...doc, fragment: null })),
    '## Current checkpoint', renderSource(result.ledger),
    '## Observed state',
    ...result.repositories.map(repo => JSON.stringify(repo, null, 2)),
    `Review notes (${result.notes.length}):\n${JSON.stringify(result.notes, null, 2)}`,
    `Invoking checkout (association only):\n${JSON.stringify(result.invokingCheckout, null, 2)}`,
    `Pending lifecycle operations:\n${JSON.stringify(result.pendingOperations, null, 2)}`,
    `Diagnostics:\n${JSON.stringify(result.diagnostics, null, 2)}`,
    '## Navigation and operating rules',
    ...result.navigation.map(link => `- ${link.label}: ${link.path}${link.fragment === null ? '' : `#${link.fragment}`}`),
    ...result.entryRules.map(rule => `- ${rule}`),
  ].join('\n\n');
}
