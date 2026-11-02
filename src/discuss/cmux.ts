import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** The cmux operations a discussion needs; injected so tests never touch a real terminal. */
export interface CmuxAdapter {
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  openWorkspace(options: { name: string; description: string; cwd: string; command: string }): Promise<{ workspace: string; surface: string | null }>;
  addPane(options: { workspace: string; cwd: string; command: string }): Promise<{ surface: string | null }>;
  renameOwnTab(title: string): Promise<void>;
  closeWorkspace(workspace: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Closes the workspace of a final discussion. Only a UUID is closed, because
 * cmux can reassign a short ref such as `workspace:3` to another workspace.
 */
export async function closeDiscussionWorkspace(cmux: CmuxAdapter | null, presentation: { kind: string | null; workspace: string | null }): Promise<boolean> {
  if (cmux === null || presentation.kind !== 'cmux' || presentation.workspace === null || !UUID.test(presentation.workspace)) return false;
  await cmux.closeWorkspace(presentation.workspace);
  return true;
}

function refs(output: string): Record<string, string | undefined> {
  try {
    return JSON.parse(output) as Record<string, string | undefined>;
  } catch {
    return {
      workspace_ref: output.match(/workspace:\d+/)?.[0],
      pane_ref: output.match(/pane:\d+/)?.[0],
      surface_ref: output.match(/surface:\d+/)?.[0],
    };
  }
}

export function systemCmux(bin: string, env: NodeJS.ProcessEnv = process.env): CmuxAdapter {
  const run = async (args: string[]) => (await exec(bin, ['--json', ...args], { timeout: 15_000, env })).stdout;
  return {
    async available() {
      try {
        JSON.parse(await run(['identify']));
        return { ok: true };
      } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
        return { ok: false, reason: detail.split('\n')[0] ?? 'cmux is unavailable' };
      }
    },
    async openWorkspace({ name, description, cwd, command }) {
      const out = refs(await run(['new-workspace', '--name', name, '--description', description, '--cwd', cwd, '--command', command, '--focus', 'false']));
      const ref = out['workspace_ref'];
      if (!ref) throw new Error('cmux did not report the new workspace');
      const id = await run(['--id-format', 'both', 'list-workspaces'])
        .then((listed) => (JSON.parse(listed) as { workspaces?: Array<{ id?: string; ref?: string }> }).workspaces?.find((item) => item.ref === ref)?.id)
        .catch(() => undefined);
      return { workspace: id ?? ref, surface: out['surface_ref'] ?? null };
    },
    async addPane({ workspace, command }) {
      const out = refs(await run(['new-pane', '--workspace', workspace, '--direction', 'right', '--command', command, '--focus', 'false']));
      return { surface: out['surface_ref'] ?? null };
    },
    async renameOwnTab(title) {
      await run(['rename-tab', '--', title]);
    },
    async closeWorkspace(workspace) {
      await run(['close-workspace', '--workspace', workspace]);
    },
  };
}
