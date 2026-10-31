import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/**
 * Closes the workspace of a final discussion. Only a UUID is closed, because
 * cmux can reassign a short ref such as `workspace:3` to another workspace.
 */
export async function closeDiscussionWorkspace(cmux, presentation) {
    if (cmux === null || presentation.kind !== 'cmux' || presentation.workspace === null || !UUID.test(presentation.workspace))
        return false;
    await cmux.closeWorkspace(presentation.workspace);
    return true;
}
function refs(output) {
    try {
        return JSON.parse(output);
    }
    catch {
        return {
            workspace_ref: output.match(/workspace:\d+/)?.[0],
            pane_ref: output.match(/pane:\d+/)?.[0],
            surface_ref: output.match(/surface:\d+/)?.[0],
        };
    }
}
export function systemCmux(bin, env = process.env) {
    const run = async (args) => (await exec(bin, ['--json', ...args], { timeout: 15_000, env })).stdout;
    return {
        async available() {
            try {
                JSON.parse(await run(['identify']));
                return { ok: true };
            }
            catch (error) {
                const detail = error.stderr?.trim() || error.message;
                return { ok: false, reason: detail.split('\n')[0] ?? 'cmux is unavailable' };
            }
        },
        async openWorkspace({ name, description, cwd, command }) {
            const out = refs(await run(['new-workspace', '--name', name, '--description', description, '--cwd', cwd, '--command', command, '--focus', 'false']));
            const ref = out['workspace_ref'];
            if (!ref)
                throw new Error('cmux did not report the new workspace');
            const id = await run(['--id-format', 'both', 'list-workspaces'])
                .then((listed) => JSON.parse(listed).workspaces?.find((item) => item.ref === ref)?.id)
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
//# sourceMappingURL=cmux.js.map