import { expect, test } from 'claude-code/testing'

const OK = (data: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify({ ok: true, data }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

function recordRuns(on: any): Array<{ argv: readonly string[]; stdin?: string }> {
  const runs: Array<{ argv: readonly string[]; stdin?: string }> = []
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { stdin?: string } }) => {
    runs.push({ argv: e.argv, ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }) })
    if (e.argv.includes('current')) return OK({ state: 'resolved', initiative: 'demo', source: 'branch', currentTask: 'Review' })
    if (e.argv.includes('submit')) return { value: { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { code: 'REVIEW_STALE', message: 'stale' } }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return OK({})
  })
  on('process.spawn', async function* () { return { value: { code: 0, signal: null } } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/w' }))
  return runs
}

const finishes = (runs: Array<{ argv: readonly string[] }>) => runs.filter(run => run.argv.includes('finish')).map(run => run.argv.slice(run.argv.indexOf('--batch')))

test('a stored prompt row carrying a batch marker records the receipt, and other rows do not', async ($, on) => {
  const runs = recordRuns(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const row = (text: string, origin: any, uuid: string) => $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }, door: 'prompt', origin, uuid,
  } as any)

  await row('<grind-review batch=b-1-abc comments=1 init=demo>\n...', { kind: 'composer' }, 'u-typed')
  await row('<grind-review batch=b-2-def comments=1 init=demo>', { kind: 'plugin', name: 'grind' }, 'u-plugin')
  await row('<grind-review batch=b-3-ghi comments=1 init=demo>', { kind: 'plugin', name: 'other' }, 'u-other')
  await row('an ordinary prompt', { kind: 'composer' }, 'u-plain')

  expect(finishes(runs)).toEqual([
    ['--batch', 'b-1-abc', '--attempt', 'latest', '--status', 'received', '--row', 'u-typed', '--json'],
    ['--batch', 'b-2-def', '--attempt', 'latest', '--status', 'received', '--row', 'u-plugin', '--json'],
  ])
})

test('add-to-review quotes the transcript selection with its row, and falls back to cmux without one', async ($, on) => {
  const runs = recordRuns(on)
  let selection: { text: string; requestId?: string } | undefined = { text: 'cache layer', requestId: 'row-7' }
  on('ui.selection', () => ({ value: selection }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'add-to-review', args: '' } as any)
  const added = runs.find(run => run.argv.includes('add'))
  expect(JSON.parse(added?.stdin ?? '{}').source.messageId).toBe('row-7')
  expect(JSON.parse(added?.stdin ?? '{}').quote).toBe('cache layer')

  selection = undefined
  await $.command.run({ command: 'add-to-review', args: '' } as any)
  expect(runs.some(run => run.argv.includes('capture-cmux'))).toBe(true)
})

const PANE = {
  plugin: 'grind',
  component: 'Pane',
  requestId: 'grind-review',
  props: { title: 'Grind review', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane shows quotes safely, counts only comments that will be sent, and can send a frozen batch left pending', async ($, on) => {
  const draft = {
    id: 'd-1', revision: 3, association: { workspace: '/w', initiative: 'demo', source: 'inferred' },
    comments: [
      { id: 'c1', source: { kind: 'claude-reply', sessionId: 's', messageId: 'm' }, quote: 'bell\u0007 and \u001b[31mred', body: 'why', deletedAt: null },
      { id: 'c2', source: { kind: 'markdown', path: '/w/plan.md', lines: null, location: 'ambiguous' }, quote: 'Ship it.', body: '', deletedAt: null },
      { id: 'c3', source: { kind: 'terminal', surfaceId: null, workspaceId: null, sessionId: null }, quote: 'gone', body: '', deletedAt: '2026-10-26T00:00:00Z' },
    ],
  }
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: e.key === 'view'
      ? { value: { shape: 'review-view-1', value: { sessionId: 's', draft, batches: [{ id: 'b-1-pending', submittedAt: '', comments: 1, delivery: { state: 'pending', rowUuid: null, resolution: { state: 'open' } } }] } }, version: 1 }
      : e.key === 'current'
        ? { value: { shape: 'current-init-1', value: { state: 'resolved', initiative: 'demo', source: 'branch', currentTask: 'Review' } }, version: 1 }
        : { value: { shape: 'notice-1', value: '' }, version: 1 },
  }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: 'send' }))?.text).toBe('Send review · 2')
    expect((await ui.find({ type: 'Text', text: /plan\.md \(repeated passage\)/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /\u001b|\u0007/ }))).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'restore:c3' }))).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'send:b-1-pending' }))).toBeDefined()
    await ui.unmount()
  }
})

test('a control pressed after the draft changed acts on the draft it showed', async ($, on) => {
  const runs = recordRuns(on)
  const comment = { id: 'c1', source: { kind: 'claude-reply', sessionId: 's', messageId: null }, quote: 'old passage', body: '', deletedAt: null }
  let draft = { id: 'd-old', revision: 3, association: { workspace: '/w', initiative: null, source: 'none' }, comments: [comment] }
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: e.key === 'view'
      ? { value: { shape: 'review-view-1', value: { sessionId: 's', draft, batches: [] } }, version: 1 }
      : { value: { shape: e.key === 'current' ? 'current-init-1' : 'notice-1', value: e.key === 'current' ? null : '' }, version: 1 },
  }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  draft = { ...draft, id: 'd-new', revision: 1, comments: [{ ...comment, quote: 'new passage' }] }

  await ui.press({ key: 'delete:c1' })
  await ui.press({ key: 'send' })
  const deleted = runs.find(run => run.argv.includes('delete'))?.argv ?? []
  const submitted = runs.find(run => run.argv.includes('submit'))?.argv ?? []
  expect(deleted.slice(deleted.indexOf('--draft'), deleted.indexOf('--draft') + 4)).toEqual(['--draft', 'd-old', '--expect-revision', '3'])
  expect(submitted.slice(submitted.indexOf('--draft'), submitted.indexOf('--draft') + 4)).toEqual(['--draft', 'd-old', '--revision', '3'])
  await ui.unmount()
})
