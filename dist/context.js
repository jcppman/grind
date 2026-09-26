import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.js';
import { markdownSection, navigation, requiredLinks, resolveLink } from './context-markdown.js';
import { diagnostic, hasErrors } from './errors.js';
import { parseFrontmatter } from './frontmatter.js';
import { git, gitCurrentBranch, gitToplevel } from './git.js';
import { inspectInitiative } from './inspect.js';
import { pendingOperationSummaries } from './operations.js';
import { resolveInitiative } from './resolve.js';
import { readSidecar } from './sidecar.js';
export const ENTRY_RULES = [
    'The user’s current request determines the task; the recorded next action is only a candidate.',
    'Context loading is read-only: do not fetch, switch, reopen, repair pointers, handle notes, or save as part of loading.',
    'Inspect pending review notes before resuming implementation.',
    'Load the relevant specification and plan before changing behavior.',
    'Checkpoint meaningful work through the save workflow. Load operation-specific skills when needed.',
];
function source(doc) {
    return doc ? { path: doc.path, fragment: null, body: doc.frontmatter.body, metadata: doc.frontmatter.data } : null;
}
function contained(root, file) {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function checkoutDetails(root) {
    const sidecar = await readSidecar(root);
    const head = await git(['rev-parse', '--verify', 'HEAD'], root);
    return {
        path: root,
        branch: await gitCurrentBranch(root),
        head: head.ok ? head.stdout.trim() : null,
        association: sidecar?.initiative ?? null,
        sidecarPath: sidecar?.path ?? null,
        notes: sidecar?.notes.map(({ reference, path, start, end, anchor }) => ({ reference, path, start, end, anchor })) ?? [],
        diagnostics: sidecar?.diagnostics ?? [],
    };
}
export async function contextCommand(context, identifier) {
    const resolution = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
    const record = await readInitiative(resolution.initiative.dir, { workspace: context.workspace });
    const inspection = await inspectInitiative(context.workspace, resolution.initiative, record);
    const diagnostics = [...resolution.diagnostics, ...inspection.diagnostics];
    const intent = source(record.intent);
    const ledger = source(record.ledger);
    const constraints = [];
    const seen = new Set([intent?.path, ledger?.path].filter(Boolean).map(file => `${file}#`));
    let links = [];
    if (record.index) {
        try {
            links = navigation(record.index.frontmatter.body, record.index.path);
        }
        catch (error) {
            diagnostics.push(diagnostic('error', 'CONTEXT_LINK_INVALID', error.message, record.index.path));
        }
        let required = [];
        try {
            required = requiredLinks(record.index.frontmatter.body);
        }
        catch (error) {
            diagnostics.push(diagnostic('error', 'CONTEXT_REQUIRED_INVALID', error.message, record.index.path));
        }
        for (const href of required) {
            try {
                const link = resolveLink(href, record.index.path);
                if (link.external)
                    throw new Error(`Required read must be local Markdown: ${href}`);
                const file = await realpath(link.path);
                if (![context.workspace.root, context.workspace.stateDir].some(root => contained(root, file))) {
                    throw new Error(`Required read is outside workspace and state roots: ${href}`);
                }
                if (!file.endsWith('.md'))
                    throw new Error(`Required read must be Markdown: ${href}`);
                const key = `${file}#${link.fragment ?? ''}`;
                const doc = record.documents.find(doc => doc.path === file);
                const parsed = doc?.frontmatter ?? parseFrontmatter(await readFile(file, 'utf8'));
                if (parsed.error)
                    throw new Error(parsed.error);
                const body = link.fragment === null ? parsed.body : markdownSection(parsed.body, link.fragment);
                if (seen.has(key) || seen.has(`${file}#`))
                    continue;
                constraints.push({ path: file, fragment: link.fragment, body, metadata: parsed.data });
                seen.add(key);
            }
            catch (error) {
                diagnostics.push(diagnostic('error', 'CONTEXT_REQUIRED_INVALID', `${href}: ${error.message}`, record.index.path));
            }
        }
    }
    const repositories = [];
    for (const repository of [...inspection.repositories].sort((a, b) => a.observed.path.localeCompare(b.observed.path))) {
        repositories.push({ ...repository, details: repository.observed.repository ? await checkoutDetails(repository.observed.path) : null });
    }
    const invokingRoot = await gitToplevel(context.cwd);
    const invokingCheckout = invokingRoot ? await checkoutDetails(invokingRoot) : null;
    if (invokingCheckout) {
        diagnostics.push(...invokingCheckout.diagnostics);
        if (invokingCheckout.association && invokingCheckout.association !== inspection.id) {
            diagnostics.push(diagnostic('warning', 'INVOKING_CHECKOUT_ASSOCIATION', `Invoking checkout points to ${invokingCheckout.association}; selected init is ${inspection.id}.`, invokingCheckout.path));
        }
    }
    const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter(op => op.target === inspection.id || `_archive/${op.target}` === inspection.id);
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        workspace: context.workspace.root,
        id: inspection.id,
        dir: inspection.dir,
        archived: inspection.archived,
        resolution: { source: resolution.source, stalePointer: resolution.stalePointer },
        state: inspection.state,
        complete: Boolean(intent && ledger && record.index && inspection.state) && !hasErrors(diagnostics),
        intent, constraints, ledger, repositories, invokingCheckout, pendingOperations,
        diagnostics, navigation: links, entryRules: ENTRY_RULES,
    };
}
function renderSource(doc) {
    if (!doc)
        return 'Missing required source.';
    return `Source: ${doc.path}${doc.fragment === null ? '' : `#${doc.fragment}`}\nMetadata: ${JSON.stringify(doc.metadata)}\n\n${doc.body}`;
}
export function formatContext(result) {
    return [
        `# Init context: ${result.id}`,
        `Folder: ${result.dir}\nWorkspace: ${result.workspace}\nStatus: ${result.state?.status ?? 'malformed'}${result.archived ? ' (archived)' : ''}\nResolved via: ${result.resolution.source}\nCaptured: ${result.generatedAt}\nComplete: ${result.complete ? 'yes' : 'NO — resolve diagnostics before substantive work'}`,
        '## Purpose and constraints', renderSource(result.intent), ...result.constraints.map(renderSource),
        '## Current checkpoint', renderSource(result.ledger),
        '## Observed state',
        ...result.repositories.map(repo => JSON.stringify(repo, null, 2)),
        `Invoking checkout (association only):\n${JSON.stringify(result.invokingCheckout, null, 2)}`,
        `Pending lifecycle operations:\n${JSON.stringify(result.pendingOperations, null, 2)}`,
        `Diagnostics:\n${JSON.stringify(result.diagnostics, null, 2)}`,
        '## Navigation and operating rules',
        ...result.navigation.map(link => `- ${link.label}: ${link.path}${link.fragment === null ? '' : `#${link.fragment}`}`),
        ...result.entryRules.map(rule => `- ${rule}`),
    ].join('\n\n');
}
//# sourceMappingURL=context.js.map