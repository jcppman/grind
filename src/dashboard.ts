import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { listInitiatives } from './discovery.ts';
import { inspectInitiative } from './inspect.ts';
import type { Workspace } from './workspace.ts';
import { dashboardHtml, dashboardScript } from './dashboard-view.ts';

export function directoryCommand(directory: string, platform: NodeJS.Platform = process.platform): string {
  // PowerShell is the default Windows terminal shell; -LiteralPath stops it
  // treating [ and ] as wildcards.
  if (platform === 'win32') return `Set-Location -LiteralPath '${directory.replaceAll("'", "''")}'`;
  return `cd '${directory.replaceAll("'", "'\\''")}'`;
}

export async function dashboardData(workspace: Workspace) {
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
        status: inspection.state?.status ?? null,
        task: inspection.state?.current_task ?? null,
        next: inspection.state?.next_action ?? null,
        result: inspection.state?.result ?? null,
        diagnostics: inspection.diagnostics,
        repositories: inspection.repositories.map(({ recorded, observed, onRecordedBranch }) => ({
          name: recorded.path,
          directory: observed.path,
          command: observed.exists && observed.repository ? directoryCommand(observed.path) : null,
          branch: recorded.branch,
          actualBranch: observed.branch,
          onRecordedBranch,
          changes: observed.changedFiles.length,
          available: observed.exists && observed.repository,
        })),
      });
    } catch (error) {
      initiatives.push({
        id: entry.id, directory: entry.dir, command: directoryCommand(entry.dir), archived: entry.archived,
        status: null, task: null, next: null, result: null, repositories: [],
        diagnostics: [{ severity: 'error', code: 'INSPECTION_FAILED', message: (error as Error).message }],
      });
    }
  }
  return { workspace: workspace.root, refreshedAt: new Date().toISOString(), initiatives, diagnostics: listing.diagnostics };
}

type Editor = 'vscode' | 'webstorm';
type OpenEditor = (editor: Editor, directory: string) => Promise<void>;

const exec = promisify(execFile);
const openEditor: OpenEditor = async (editor, directory) => {
  try {
    if (process.platform === 'darwin') {
      await exec('/usr/bin/open', ['-a', editor === 'vscode' ? 'Visual Studio Code' : 'WebStorm', directory]);
    } else if (process.platform === 'win32') {
      // Both launchers are .cmd scripts, which only cmd.exe can run. Inside
      // quotes cmd still expands %VAR%, so refuse paths it cannot pass intact.
      if (/["%]/.test(directory)) throw new Error('unquotable path');
      const launcher = editor === 'vscode' ? 'code' : 'webstorm';
      await exec(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${launcher} "${directory}""`], {
        timeout: 10000,
        windowsVerbatimArguments: true,
      });
    } else {
      await exec(editor === 'vscode' ? 'code' : 'webstorm', [directory], { timeout: 10000 });
    }
  } catch {
    throw new Error(`Could not open ${editor === 'vscode' ? 'VS Code' : 'WebStorm'}. Check that the editor is installed${process.platform === 'darwin' ? '.' : ' and its command-line launcher is on PATH.'}`);
  }
};

export async function serveDashboard(workspace: Workspace, launch: OpenEditor = openEditor) {
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
    if (request.method === 'POST' && request.url === `${prefix}open`) {
      if (request.headers.origin !== `http://127.0.0.1:${address.port}` || request.headers['content-type'] !== 'application/json') {
        response.writeHead(403).end('Forbidden');
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8192) {
            response.writeHead(413).end('Request too large');
            return;
          }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { input = null; }
        if (!input || typeof input.id !== 'string' || !['vscode', 'webstorm'].includes(input.editor)) {
          response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Choose a valid init and editor.' }));
          return;
        }
        const listing = await listInitiatives(workspace.initiativesDir);
        const entry = listing.entries.find(entry => entry.id === input.id);
        if (!entry) {
          response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Init folder is no longer available. Refresh and try again.' }));
          return;
        }
        await launch(input.editor, entry.dir);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ opened: true }));
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }));
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
      } else if (request.url === `${prefix}app.js`) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(dashboardScript);
      } else if (request.url === `${prefix}api`) {
        const data = await dashboardData(workspace);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
      } else {
        response.writeHead(404).end('Not found');
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Dashboard did not receive a local port');
  return {
    url: `http://127.0.0.1:${address.port}${prefix}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}
