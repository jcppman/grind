import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { listInitiatives } from './discovery.js';
import { GrindError } from './errors.js';
import { formatSwitch } from './format.js';
import { inspectInitiative } from './inspect.js';
import { tracksPath } from './resolve.js';
import { switchCommand } from './worktree.js';
import { dashboardHtml, dashboardScript } from './dashboard-view.js';
export function directoryCommand(directory, platform = process.platform) {
    // PowerShell is the default Windows terminal shell; -LiteralPath stops it
    // treating [ and ] as wildcards.
    if (platform === 'win32')
        return `Set-Location -LiteralPath '${directory.replaceAll("'", "''")}'`;
    return `cd '${directory.replaceAll("'", "'\\''")}'`;
}
export async function dashboardData(workspace) {
    const listing = await listInitiatives(workspace.initiativesDir);
    const initiatives = [];
    for (const entry of listing.entries) {
        try {
            const inspection = await inspectInitiative(workspace, entry);
            initiatives.push({
                id: entry.id,
                directory: entry.dir,
                command: directoryCommand(entry.dir),
                archived: entry.archived,
                roadmap: inspection.roadmap,
                status: inspection.state?.status ?? null,
                task: inspection.state?.current_task ?? null,
                next: inspection.state?.next_action ?? null,
                result: inspection.state?.result ?? null,
                diagnostics: inspection.diagnostics,
                repositories: inspection.repositories.map(({ recorded, observed }) => ({
                    name: recorded.path,
                    directory: observed.path ?? observed.canonical,
                    command: observed.path === null ? null : directoryCommand(observed.path),
                    branch: recorded.branch,
                    location: observed.kind,
                    changes: observed.changedFiles.length,
                    available: observed.repository,
                })),
            });
        }
        catch (error) {
            initiatives.push({
                id: entry.id, directory: entry.dir, command: directoryCommand(entry.dir), archived: entry.archived,
                status: null, task: null, next: null, result: null, roadmap: null, repositories: [],
                diagnostics: [{ severity: 'error', code: 'INSPECTION_FAILED', message: error.message }],
            });
        }
    }
    return { workspace: workspace.root, refreshedAt: new Date().toISOString(), initiatives, diagnostics: listing.diagnostics };
}
const exec = promisify(execFile);
const openEditor = async (editor, directory) => {
    try {
        if (process.platform === 'darwin') {
            await exec('/usr/bin/open', ['-a', editor === 'vscode' ? 'Visual Studio Code' : 'WebStorm', directory]);
        }
        else if (process.platform === 'win32') {
            // Both launchers are .cmd scripts, which only cmd.exe can run. Inside
            // quotes cmd still expands %VAR%, so refuse paths it cannot pass intact.
            if (/["%]/.test(directory))
                throw new Error('unquotable path');
            const launcher = editor === 'vscode' ? 'code' : 'webstorm';
            await exec(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${launcher} "${directory}""`], {
                timeout: 10000,
                windowsVerbatimArguments: true,
            });
        }
        else {
            await exec(editor === 'vscode' ? 'code' : 'webstorm', [directory], { timeout: 10000 });
        }
    }
    catch {
        throw new Error(`Could not open ${editor === 'vscode' ? 'VS Code' : 'WebStorm'}. Check that the editor is installed${process.platform === 'darwin' ? '.' : ' and its command-line launcher is on PATH.'}`);
    }
};
class RequestTooLarge extends Error {
}
async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192)
            throw new RequestTooLarge();
        chunks.push(chunk);
    }
    try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return typeof input === 'object' && input !== null && !Array.isArray(input) ? input : null;
    }
    catch {
        return null;
    }
}
/** Brings an open init's branch into the canonical checkout of one of its recorded repositories. */
async function switchFromDashboard(workspace, input, switcher) {
    if (!input || typeof input['id'] !== 'string' || typeof input['repository'] !== 'string' || (input['force'] !== undefined && typeof input['force'] !== 'boolean')) {
        return { status: 400, body: { error: 'Choose a valid init and repository.' } };
    }
    const entry = (await listInitiatives(workspace.initiativesDir)).entries.find((item) => item.id === input['id']);
    const inspection = entry === undefined || entry.archived ? null : await inspectInitiative(workspace, entry);
    const recorded = inspection?.state?.status === 'open' ? inspection.repositories.find((item) => tracksPath(item.recorded, input['repository'])) : undefined;
    if (entry === undefined || recorded === undefined) {
        return { status: 404, body: { error: 'That init no longer tracks this repository as open work. Refresh and try again.' } };
    }
    try {
        const result = await switcher({ workspace, cwd: path.resolve(workspace.root, recorded.recorded.path) }, entry.id, { force: input['force'] === true });
        return { status: 200, body: { message: formatSwitch(result) } };
    }
    catch (error) {
        if (!(error instanceof GrindError))
            throw error;
        const details = error.details;
        return { status: 409, body: { error: error.message, code: error.code, canForce: error.code === 'SWITCH_BLOCKED' && Array.isArray(details?.recent) } };
    }
}
export async function serveDashboard(workspace, launch = openEditor, switcher = switchCommand) {
    const prefix = `/${randomBytes(24).toString('hex')}/`;
    const nonce = randomBytes(18).toString('base64');
    const server = createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
        const address = server.address();
        if (!address || typeof address === 'string' || request.headers.host !== `127.0.0.1:${address.port}` || request.headers['sec-fetch-site'] === 'cross-site') {
            response.writeHead(403).end('Forbidden');
            return;
        }
        if (request.method === 'POST' && (request.url === `${prefix}open` || request.url === `${prefix}switch`)) {
            if (request.headers.origin !== `http://127.0.0.1:${address.port}` || request.headers['content-type'] !== 'application/json') {
                response.writeHead(403).end('Forbidden');
                return;
            }
            try {
                let input;
                try {
                    input = await readJson(request);
                }
                catch (error) {
                    if (!(error instanceof RequestTooLarge))
                        throw error;
                    response.writeHead(413).end('Request too large');
                    return;
                }
                if (request.url === `${prefix}switch`) {
                    const result = await switchFromDashboard(workspace, input, switcher);
                    response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body));
                    return;
                }
                if (!input || typeof input['id'] !== 'string' || !['vscode', 'webstorm'].includes(input['editor']) || (input['target'] !== undefined && !['init', 'roadmap'].includes(input['target']))) {
                    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Choose a valid init and editor.' }));
                    return;
                }
                const listing = await listInitiatives(workspace.initiativesDir);
                const entry = listing.entries.find(entry => entry.id === input['id']);
                if (!entry) {
                    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Init folder is no longer available. Refresh and try again.' }));
                    return;
                }
                const target = input['target'] === 'roadmap'
                    ? (await inspectInitiative(workspace, entry)).roadmap?.path
                    : entry.dir;
                if (!target) {
                    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Roadmap is no longer available. Refresh and try again.' }));
                    return;
                }
                await launch(input['editor'], target);
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ opened: true }));
            }
            catch (error) {
                response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
            }
            return;
        }
        if (request.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
            return;
        }
        try {
            if (request.url === prefix) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(dashboardHtml(nonce));
            }
            else if (request.url === `${prefix}app.js`) {
                response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(dashboardScript);
            }
            else if (request.url === `${prefix}api`) {
                const data = await dashboardData(workspace);
                response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
            }
            else {
                response.writeHead(404).end('Not found');
            }
        }
        catch (error) {
            response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Dashboard did not receive a local port');
    return {
        url: `http://127.0.0.1:${address.port}${prefix}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeIdleConnections();
        }),
    };
}
//# sourceMappingURL=dashboard.js.map