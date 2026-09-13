import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Grind Test',
  GIT_AUTHOR_EMAIL: 'grind@example.invalid',
  GIT_COMMITTER_NAME: 'Grind Test',
  GIT_COMMITTER_EMAIL: 'grind@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  return stdout.trim();
}

export interface TempWorkspace {
  root: string;
  stateDir: string;
  stateGitRoot: string;
  initiativesDir: string;
  cleanup: () => Promise<void>;
}

export interface TempWorkspaceOptions {
  /** `root`: state dir is its own repository; `subdir`: state dir sits inside a containing repository. */
  stateLayout?: 'root' | 'subdir';
}

export async function makeTempWorkspace(options: TempWorkspaceOptions = {}): Promise<TempWorkspace> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'grind-')));
  const layout = options.stateLayout ?? 'root';
  const stateGitRoot = layout === 'root' ? path.join(root, 'grind-state') : path.join(root, 'container');
  const stateDir = layout === 'root' ? stateGitRoot : path.join(stateGitRoot, 'grind-state');
  const stateRepository = layout === 'root' ? './grind-state' : './container/grind-state';
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(root, 'grind-workspace.json'), JSON.stringify({ stateRepository }, null, 2));
  await git(stateGitRoot, 'init', '-q', '-b', 'main');
  await writeFile(path.join(stateDir, 'README.md'), '# state\n');
  await git(stateGitRoot, 'add', '-A');
  await git(stateGitRoot, 'commit', '-q', '-m', 'init');
  return {
    root,
    stateDir,
    stateGitRoot,
    initiativesDir: path.join(stateDir, 'initiatives'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface RepositoryTracking {
  path: string;
  branch: string;
  checkout?: string;
  pull_request?: string | null;
}

export function openLedger(
  repositories: RepositoryTracking[] = [],
  extra: { body?: string; frontmatter?: string } = {},
): string {
  const repos =
    repositories.length === 0
      ? '  repositories: []\n'
      : `  repositories:\n${repositories
          .map(
            (r) =>
              `    - path: ${r.path}\n      branch: ${r.branch}\n      checkout: ${r.checkout ?? 'clone'}\n      pull_request: ${r.pull_request ?? 'null'}\n`,
          )
          .join('')}`;
  return `---
type: Initiative Ledger
grind:
  status: open
  updated_at: "2026-09-13T10:00:00+09:00"
  phase: implementation
  current_task: Do the thing
  next_action: Keep doing it
${repos}${extra.frontmatter ?? ''}---

# Initiative Ledger
${extra.body ?? ''}`;
}

export function closedLedger(repositories: RepositoryTracking[] = []): string {
  const repos =
    repositories.length === 0
      ? '  repositories: []\n'
      : `  repositories:\n${repositories
          .map((r) => `    - path: ${r.path}\n      branch: ${r.branch}\n      checkout: clone\n`)
          .join('')}`;
  return `---
type: Initiative Ledger
grind:
  status: closed
  updated_at: "2026-09-13T10:00:00+09:00"
  result: Shipped in v1
  closed:
    date: "2026-09-01"
    outcome: delivered
${repos}---

# Initiative Ledger
`;
}

export const INTENT = `---
type: Initiative Intent
---

# Do the thing
`;

export const INDEX = `# Thing

- [Intent](intent.md)
- [Ledger](ledger.md)
`;

export interface InitiativeFiles {
  index?: string | null;
  intent?: string | null;
  ledger?: string | null;
  /** Extra files relative to the initiative folder. */
  files?: Record<string, string>;
}

export async function writeInitiative(
  ws: TempWorkspace,
  id: string,
  files: InitiativeFiles = {},
): Promise<string> {
  const dir = path.join(ws.initiativesDir, ...id.split('/'));
  await mkdir(dir, { recursive: true });
  const entries: Array<[string, string | null | undefined]> = [
    ['index.md', files.index === undefined ? INDEX : files.index],
    ['intent.md', files.intent === undefined ? INTENT : files.intent],
    ['ledger.md', files.ledger === undefined ? openLedger() : files.ledger],
    ...Object.entries(files.files ?? {}),
  ];
  for (const [name, content] of entries) {
    if (content === null || content === undefined) continue;
    const target = path.join(dir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
}

export async function commitState(ws: TempWorkspace, message = 'checkpoint'): Promise<string> {
  await git(ws.stateGitRoot, 'add', '-A');
  await git(ws.stateGitRoot, 'commit', '-q', '-m', message);
  return git(ws.stateGitRoot, 'rev-parse', 'HEAD');
}

/** Creates a repository under the workspace root checked out on `branch`. */
export async function makeCheckout(ws: TempWorkspace, relativePath: string, branch = 'main'): Promise<string> {
  const dir = path.join(ws.root, relativePath);
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  await writeFile(path.join(dir, 'README.md'), '# app\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'init');
  if (branch !== 'main') await git(dir, 'checkout', '-q', '-b', branch);
  return dir;
}

export async function writeSidecar(checkoutDir: string, initiative: string | null, notes = ''): Promise<void> {
  const header = initiative === null ? '' : `---\ninitiative: ${initiative}\n---\n\n`;
  await writeFile(path.join(checkoutDir, '.grind.md'), `${header}${notes}`);
}

export async function makeSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
}
