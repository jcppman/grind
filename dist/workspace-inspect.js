import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { listCommand } from './commands.js';
import { readInitiative } from './artifacts.js';
import { inspectInitiative } from './inspect.js';
import { readRoadmaps } from './roadmaps.js';
import { readNotes } from './notes.js';
import { hasErrors } from './errors.js';
import { git } from './git.js';
import { markdownSection, navigation, requiredLinks } from './context-markdown.js';
import { pendingOperationSummaries } from './operations.js';
const exec = promisify(execFile);
export async function githubReader() {
    const call = async (args) => (await exec('gh', args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    if ((await call(['api', 'user', '--jq', '.login'])).trim() !== 'jcppman')
        throw new Error('Workspace inspection requires the jcppman GitHub identity.');
    return async (url) => {
        const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/.exec(url);
        if (!match)
            throw new Error('Remote inspection requires a github.com pull request URL.');
        return JSON.parse(await call(['pr', 'view', match[2], '--repo', match[1], '--json', 'url,state,isDraft,headRefOid,baseRefName,reviewDecision,statusCheckRollup,mergedAt,mergeCommit']));
    };
}
export async function inspectWorkspace(context, options = {}, remoteFactory = githubReader) {
    const listing = await listCommand(context, options);
    const pendingOperations = await pendingOperationSummaries(context.workspace);
    const roadmapCatalog = await readRoadmaps(context.workspace.stateDir);
    let remote = null, remoteError = null;
    if (options.remote) {
        try {
            remote = await remoteFactory();
        }
        catch (error) {
            remoteError = error.message;
        }
    }
    const cache = new Map();
    const initiatives = [];
    for (const entry of listing.initiatives) {
        try {
            const record = await readInitiative(entry.dir, { workspace: context.workspace, roadmapCatalog });
            const loaded = await inspectInitiative(context.workspace, { id: entry.id, dir: entry.dir, archived: false }, record);
            const linkDiagnostics = [];
            const links = record.index ? navigation(record.index.frontmatter.body, record.index.path) : [];
            if (record.index) {
                try {
                    for (const href of requiredLinks(record.index.frontmatter.body)) {
                        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href))
                            throw new Error('Required context links must be local.');
                    }
                }
                catch (error) {
                    linkDiagnostics.push({ path: record.index.path, error: error.message });
                }
            }
            const repositories = [];
            for (const repository of loaded.repositories) {
                const head = repository.observed.path ? await git(['rev-parse', '--verify', 'HEAD'], repository.observed.path) : null;
                repositories.push({ ...repository, head: head?.ok ? head.stdout.trim() : null });
            }
            for (const link of links.filter(link => !link.external)) {
                try {
                    const file = await realpath(link.path);
                    const contained = [context.workspace.root, context.workspace.stateDir].some(root => {
                        const relative = path.relative(root, file);
                        return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
                    });
                    if (!contained)
                        throw new Error('Link is outside workspace/state roots; not inspected.');
                    if (link.fragment && file.endsWith('.md'))
                        markdownSection(await readFile(file, 'utf8'), link.fragment);
                }
                catch (error) {
                    linkDiagnostics.push({ path: link.path, error: error.message });
                }
            }
            const pullRequests = [];
            for (const repo of loaded.repositories) {
                const url = repo.recorded.pull_request;
                if (!url)
                    continue;
                if (!options.remote) {
                    pullRequests.push({ url, status: 'not_requested' });
                    continue;
                }
                try {
                    if (!remote)
                        throw new Error(remoteError ?? 'Remote reader unavailable');
                    if (!cache.has(url))
                        cache.set(url, remote(url));
                    pullRequests.push({ url, status: 'observed', observedAt: new Date().toISOString(), data: await cache.get(url) });
                }
                catch (error) {
                    pullRequests.push({ url, status: 'unavailable', error: error.message });
                }
            }
            initiatives.push({ id: entry.id, state: loaded.state, complete: Boolean(record.intent && record.ledger && record.index && loaded.state) && !hasErrors(loaded.diagnostics) && !linkDiagnostics.length, roadmap: loaded.roadmap, repositories, notes: (await readNotes(entry.dir)).length, pendingOperations: pendingOperations.filter(op => op.target === entry.id), diagnostics: loaded.diagnostics, linkDiagnostics, pullRequests });
        }
        catch (error) {
            initiatives.push({ id: entry.id, complete: false, error: error.message });
        }
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), workspace: context.workspace.root, initiatives, diagnostics: listing.diagnostics, pendingOperations, remoteError, limitations: ['Recorded intent and readiness require judgment.', 'Remote PR state does not prove final integration or acceptance.', 'Navigation checks cover the init index, not recursive document links.', 'No fetch, checkout mutation or record writes are performed.'] };
}
//# sourceMappingURL=workspace-inspect.js.map