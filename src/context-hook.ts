import path from 'node:path';
import { contextCommand, formatContext, type ContextResult } from './context.ts';
import { GrindError } from './errors.ts';
import { isRecord } from './frontmatter.ts';
import { gitToplevel } from './git.ts';
import { readSidecar } from './sidecar.ts';
import { findWorkspaceConfig, loadWorkspace, readWorkspaceSettings } from './workspace.ts';

export const HOOK_CONTEXT_BYTES = 6000;
const ASSOCIATION_RULE = 'Automatic Grind discovery describes directory association only; it does not select an init for this conversation. An init explicitly chosen by the user takes precedence. Do not change checkout ownership or execute a next action from this hook.';

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function command(pluginRoot: string, workspace?: string, id?: string): string {
  return ['node', path.join(pluginRoot, 'scripts', 'grind.mjs'), 'context', ...(id ? [id] : []), ...(workspace ? ['--workspace', workspace] : [])].map(quote).join(' ');
}

function boundedNotice(notice: string, budget = HOOK_CONTEXT_BYTES): string {
  return Buffer.byteLength(notice, 'utf8') <= budget
    ? notice
    : 'Grind discovery needs explicit inspection; context has not been loaded. Use /grind:context. Directory association does not override the user’s chosen init.';
}

export function presentHookContext(result: ContextResult, pluginRoot: string, budget = HOOK_CONTEXT_BYTES): string {
  const recovery = command(pluginRoot, result.workspace, result.id);
  if (!result.complete || result.resolution.stalePointer) {
    return boundedNotice(`${ASSOCIATION_RULE}\nGrind context needs attention (${result.diagnostics.length} diagnostic(s), ${result.diagnostics[0]?.code ?? 'incomplete'}); full context has not been loaded. Run ${recovery} to inspect and resolve the diagnostics before working on this init.`, budget);
  }
  const full = `${ASSOCIATION_RULE}\n\n${formatContext(result)}`;
  if (Buffer.byteLength(full, 'utf8') <= budget) return full;
  return boundedNotice(`${ASSOCIATION_RULE}\nThis working directory is associated with ${result.archived ? 'archived ' : ''}${result.state?.status ?? 'unknown-status'} init ${JSON.stringify(result.id)}. Full context has not been loaded. Run ${recovery} to load it if needed.`, budget);
}

export async function sessionContext(input: unknown, pluginRoot: string): Promise<string | null> {
  let workspace: string | undefined;
  try {
    if (!isRecord(input) || typeof input['cwd'] !== 'string' || !input['cwd']) {
      throw new Error('SessionStart input requires cwd');
    }
    const cwd = input['cwd'];
    const config = await findWorkspaceConfig(cwd);
    if (!config) return null;
    workspace = path.dirname(config);
    const settings = await readWorkspaceSettings(config);
    if (!settings.contextOnSessionStart) return null;
    const result = await contextCommand({ workspace: await loadWorkspace({ cwd }), cwd });
    return presentHookContext(result, pluginRoot);
  } catch (error) {
    if (error instanceof GrindError && error.code === 'INITIATIVE_UNRESOLVED' &&
        !(isRecord(error.details) && error.details['stalePointer'])) {
      const root = isRecord(input) && typeof input['cwd'] === 'string' ? await gitToplevel(input['cwd']) : null;
      const sidecar = root ? await readSidecar(root) : null;
      if (!sidecar?.initiative && !sidecar?.diagnostics.length) return null;
    }
    const code = error instanceof GrindError ? error.code : 'CONTEXT_HOOK_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    const detail = Buffer.byteLength(message, 'utf8') <= 1000 ? `: ${message}` : '; details exceed the notice budget';
    return boundedNotice(`${ASSOCIATION_RULE}\nGrind ${code}${detail}. Full context has not been loaded. Run ${command(pluginRoot, workspace)} to investigate; use /grind:context for interactive init selection.`);
  }
}
