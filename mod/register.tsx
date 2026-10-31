import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { batchIdIn, deliveryLabel, excerpt, initSummary, liveComments, sourceLabel, splitLines } from './model.ts'
import type { BatchView, CurrentInit, ReviewView } from './types/index.d.ts'

const PANE = 'grind-review'
const SET_INIT = 'set-init'
const view = atom({ plugin: 'grind', key: 'view' } as const, null, { shape: 'review-view-1' })
const current = atom({ plugin: 'grind', key: 'current' } as const, null, { shape: 'current-init-2' })
const notice = atom({ plugin: 'grind', key: 'notice' } as const, '', { shape: 'notice-1' })

type CliResult = { ok: true; data: any } | { ok: false; code: string; message: string }

// One watcher per module instance; a reload or a new session id replaces it.
let session: { id: string; cwd: string } | null = null
let watcher: AsyncGenerator<unknown, unknown> | null = null
let lastRefresh = 0
let knownComments = new Set<string>()

async function grind($: EngineInterface, args: string[], stdin?: string): Promise<CliResult> {
  const result = await $.process.run(['node', `${$.plugin.root}/scripts/grind.mjs`, ...args, '--json'], {
    ...(session === null ? {} : { cwd: session.cwd }),
    ...(stdin === undefined ? {} : { stdin }),
  })
  try {
    const envelope = JSON.parse(result.stdout)
    return envelope.ok ? { ok: true, data: envelope.data } : { ok: false, code: envelope.error.code, message: envelope.error.message }
  } catch {
    return { ok: false, code: 'CLI_FAILED', message: (result.stderr || result.stdout || `grind exited ${result.exitCode}`).trim().slice(0, 300) }
  }
}

async function say($: EngineInterface, text: string): Promise<void> {
  await update($, notice, () => text)
}

async function refreshCurrent($: EngineInterface): Promise<void> {
  if (session === null) return
  lastRefresh = Date.now()
  const result = await grind($, ['review', 'current', '--session', session.id])
  const value: CurrentInit = result.ok ? result.data : { state: 'unavailable', reason: result.message }
  await update($, current, () => value)
  await showStatus($)
}

async function showStatus($: EngineInterface): Promise<void> {
  $.ui.status(initSummary(await read($, current), liveComments((await read($, view))?.draft ?? null).length))
}

async function bind($: EngineInterface, target: string | null, by: 'agent' | 'user'): Promise<CliResult> {
  if (session === null) return { ok: false, code: 'NOT_READY', message: 'Grind review is not ready yet.' }
  const result = await grind($, ['review', 'bind', '--session', session.id, '--by', by, ...(target === null ? ['--none'] : ['--init', target])])
  await refreshCurrent($)
  return result
}

async function applySnapshot($: EngineInterface, snapshot: ReviewView): Promise<void> {
  const comments = liveComments(snapshot.draft)
  const added = comments.filter((comment) => !knownComments.has(comment.id))
  const isFirst = knownComments.size === 0 && (await read($, view)) === null
  knownComments = new Set(comments.map((comment) => comment.id))
  await update($, view, () => snapshot)
  await showStatus($)
  if (!isFirst && added.length > 0) void $.ui.open({ id: PANE, title: 'Grind review', rows: 30 })
  for (const batch of snapshot.batches) {
    if (batch.delivery.state === 'sending' && !inFlight.has(batch.id)) void reconcile($, batch.id)
  }
}

async function runWatcher($: EngineInterface, id: string, cwd: string): Promise<void> {
  const stream = $.process.spawn({ argv: ['node', `${$.plugin.root}/scripts/grind.mjs`, 'review', 'watch', '--session', id, '--cwd', cwd, '--json'] })
  watcher = stream
  let rest = ''
  try {
    for await (const chunk of stream) {
      if (chunk.stream !== 'stdout') continue
      const split = splitLines(rest, chunk.text)
      rest = split.rest
      for (const line of split.lines) {
        const message = JSON.parse(line)
        if (message.type === 'snapshot' && session?.id === id) await applySnapshot($, message)
        else if (message.type === 'error') await say($, `Review store: ${message.error.message}`)
      }
    }
  } catch (error) {
    await say($, `Review watcher stopped: ${String(error)}`)
  }
}

async function startSession($: EngineInterface): Promise<void> {
  const previous = watcher
  watcher = null
  if (previous !== null) await previous.return(undefined)
  session = { id: await $.session.id(), cwd: await $.session.cwd() }
  knownComments = new Set()
  await update($, view, () => null)
  void runWatcher($, session.id, session.cwd)
  await refreshCurrent($)
}

// Batches this module instance is delivering; anything else still `sending` was interrupted.
const inFlight = new Set<string>()
const receipts = new Map<string, Promise<void>>()

async function deliver($: EngineInterface, batchId: string, resendUnknown: boolean): Promise<void> {
  inFlight.add(batchId)
  try {
    const started = await grind($, ['review', 'attempt', '--batch', batchId, ...(resendUnknown ? ['--resend-unknown'] : [])])
    if (!started.ok) return say($, started.message)
    const attempt = started.data.attempt.id as string
    await say($, 'Review sent; Claude reads it when idle.')
    try {
      const entered = await $.prompt.submit({ text: started.data.payload.text })
      if (entered.drop !== undefined) {
        await grind($, ['review', 'finish', '--batch', batchId, '--attempt', attempt, '--status', 'dropped', '--reason', entered.drop])
        await say($, /stopped/.test(entered.drop)
          ? 'Not delivered: after a Stop, Claude Code holds plugin prompts until you send a message. Send one and then Send again, or put the review in the prompt box and send it yourself.'
          : `Not delivered: ${entered.drop}. Your comments are kept; send again when ready.`)
      } else {
        await receipts.get(batchId)
        await say($, '')
      }
    } catch (error) {
      await grind($, ['review', 'finish', '--batch', batchId, '--attempt', attempt, '--status', 'failed', '--reason', String(error).slice(0, 300)])
      await say($, 'Review not delivered; your comments are kept.')
    }
  } finally {
    inFlight.delete(batchId)
    receipts.delete(batchId)
  }
}

// What the person saw when they acted: a press applies to that draft revision, never a newer one.
type Rendered = { sessionId: string; draftId: string; revision: number }

async function sendDraft($: EngineInterface, rendered: Rendered): Promise<void> {
  const submitted = await grind($, ['review', 'submit', '--session', rendered.sessionId, '--draft', rendered.draftId, '--revision', String(rendered.revision)])
  if (!submitted.ok) return say($, submitted.message)
  await deliver($, submitted.data.submission.id, false)
}

async function fillPrompt($: EngineInterface, batchId: string): Promise<void> {
  const shown = await grind($, ['review', 'show-batch', batchId, '--prompt'])
  if (!shown.ok) return say($, shown.message)
  const filled = await $.prompt.fill({ text: shown.data.prompt })
  await say($, filled.isFilled ? 'The review is in the prompt box; press Enter to send it.' : 'The prompt box is not available.')
}

async function reconcile($: EngineInterface, batchId: string): Promise<void> {
  const result = await grind($, ['review', 'reconcile', '--batch', batchId])
  if (!result.ok) return say($, result.message)
  await say($, result.data.found ? 'Review receipt confirmed from the transcript.' : 'Review delivery is unknown: it is not in the transcript. Resend only if Claude did not get it.')
}

async function recordReceipt($: EngineInterface, batchId: string, rowUuid: string): Promise<void> {
  await grind($, ['review', 'finish', '--batch', batchId, '--attempt', 'latest', '--status', 'received', '--row', rowUuid])
}

async function editComment($: EngineInterface, rendered: Rendered, commentId: string, action: 'edit' | 'delete' | 'restore', body?: string): Promise<void> {
  const result = await grind($, ['review', action, '--session', rendered.sessionId, '--comment', commentId, '--draft', rendered.draftId, '--expect-revision', String(rendered.revision)], body)
  await say($, result.ok ? '' : result.message)
}

async function addSelection($: EngineInterface): Promise<string> {
  if (session === null) return 'Grind review is not ready yet.'
  const selected = await $.ui.selection()
  const result = selected !== undefined && selected.text.trim() !== ''
    ? await grind($, ['review', 'add', '--session', session.id], JSON.stringify({
        source: { kind: 'claude-reply', sessionId: session.id, messageId: selected.requestId ?? null },
        quote: selected.text,
      }))
    : await grind($, ['review', 'capture-cmux', '--session', session.id])
  if (!result.ok && /CMUX_WORKSPACE_ID/.test(result.message)) return 'Nothing is selected. Select text in the fullscreen transcript, or run Claude Code inside cmux to add document selections.'
  if (!result.ok && /Nothing is selected/.test(result.message)) return 'Nothing is selected. Without the fullscreen renderer, typing clears the terminal selection; select the text and use the cmux Grind review action instead.'
  if (!result.ok) return `Not added: ${result.message}`
  void $.ui.open({ id: PANE, title: 'Grind review', rows: 30 })
  return 'Added to the review draft.'
}

function batchRow($: EngineInterface, batch: BatchView, elements: { Box: any; Text: any; Button: any }) {
  const { Box, Text, Button } = elements
  const state = batch.delivery.state
  return (
    <Box flexDirection="column">
      <Text dimColor>Sent {batch.comments} comment(s): {deliveryLabel(state)}</Text>
      {state === 'pending' && <Button key={`send:${batch.id}`} label="Send" onPress={() => { void deliver($, batch.id, false) }} />}
      {(state === 'dropped' || state === 'failed') && (
        <Box flexDirection="row" gap={1}>
          <Button key={`retry:${batch.id}`} label="Send again" onPress={() => { void deliver($, batch.id, false) }} />
          <Button key={`fill:${batch.id}`} label="Put in prompt box" onPress={() => { void fillPrompt($, batch.id) }} />
        </Box>
      )}
      {state === 'unknown' && (
        <Box flexDirection="row" gap={1}>
          <Button key={`check:${batch.id}`} label="Check transcript" onPress={() => { void reconcile($, batch.id) }} />
          <Button key={`resend:${batch.id}`} label="Resend anyway" onPress={() => { void deliver($, batch.id, true) }} />
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'add-to-review', description: 'Add the selected text to the Grind review draft', immediate: true })
    await $.command.register({ name: 'grind-review', description: 'Show the Grind review draft and current init', immediate: true })
    await $.command.register({ name: 'grind-init', description: 'Set the init this session works on, or "none" to clear it', argumentHint: '<init|none>', immediate: true })
    await $.tool.register({
      name: SET_INIT,
      description: 'Declare the Grind init (initiative) this session is working on, or clear it with null. Call it when you start or resume work on an init, switch to another init, or close the one you declared. The Grind review pane shows it, and new review drafts belong to it.',
      inputSchema: {
        type: 'object',
        properties: { init: { type: ['string', 'null'], description: 'The init id or a unique fragment of it; null when the session no longer works on an init.' } },
        required: ['init'],
      },
      isDeferred: false,
    })
    await startSession($)
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      session = null
      $.clock.after(200, () => { void startSession($) })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && Date.now() - lastRefresh > 3000) void refreshCurrent($)
    return next(e)
  })

  on('command.run', { command: 'add-to-review' }, async $ => {
    $.ui.toast(await addSelection($))
    return {}
  })

  on('command.run', { command: 'grind-review' }, async $ => {
    void refreshCurrent($)
    await $.ui.open({ id: PANE, title: 'Grind review', rows: 30 })
    return {}
  })

  on('command.run', { command: 'grind-init' }, async ($, e) => {
    const target = e.args.trim()
    if (target === '') return { text: 'Usage: /grind-init <init|none>' }
    const result = await bind($, target === 'none' ? null : target, 'user')
    return { text: result.ok ? (target === 'none' ? 'This session has no init set.' : `This session works on ${result.data.binding.initiative}.`) : result.message }
  })

  on('tool.call', { tool: `mcp__grind__${SET_INIT}` }, async ($, e) => {
    const target = (e as { init?: unknown }).init
    if (target !== null && (typeof target !== 'string' || target.trim() === '')) return { deny: 'init must be an init id or null' }
    const result = await bind($, target === null ? null : target.trim(), 'agent')
    if (!result.ok) return { deny: result.message }
    return { result: target === null ? 'No init is set for this session.' : `This session works on ${result.data.binding.initiative}.` }
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    const isOurs = e.origin.kind === 'composer' || (e.origin.kind === 'plugin' && 'name' in e.origin && e.origin.name === 'grind')
    if (e.agentId !== undefined || !isOurs || stored.uuid === undefined) return stored
    const text = stored.message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
    const batchId = batchIdIn(text)
    if (batchId !== null) receipts.set(batchId, recordReceipt($, batchId, stored.uuid))
    return stored
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e) as any
    const snapshot = await read($, view)
    const init = await read($, current)
    const message = await read($, notice)
    const columns = Math.max(20, (e.props as { bodyColumns?: number }).bodyColumns ?? 60)
    const draft = snapshot?.draft ?? null
    const comments = draft?.comments ?? []
    const live = liveComments(draft)
    const rendered: Rendered | null = snapshot !== null && draft !== null ? { sessionId: snapshot.sessionId, draftId: draft.id, revision: draft.revision } : null
    const association = draft?.association.initiative ?? (init?.state === 'resolved' ? init.initiative : null)
    return (
      <Box flexDirection="column">
        <Text bold>Grind: {initSummary(init, live.length)}</Text>
        <Text dimColor>Sends to this conversation{association === null ? '' : ` · init ${association}`}</Text>
        {message !== '' && <Text color="yellow">{message}</Text>}
        {snapshot === null && <Text dimColor>Loading the review draft…</Text>}
        {snapshot !== null && comments.length === 0 && <Text dimColor>Select text and run /add-to-review to start a review.</Text>}
        {comments.map(comment => (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor={comment.deletedAt !== null}>{comment.id} · {sourceLabel(comment.source)}{comment.deletedAt !== null ? ' · deleted' : ''}</Text>
            <Text dimColor>{excerpt(comment.quote, 4, columns - 2).replace(/^/gm, '│ ')}</Text>
            {comment.deletedAt === null
              ? (
                <Box flexDirection="column">
                  <Input key={`body:${comment.id}`} placeholder="Your comment (Enter saves)" value={comment.body} rows={2} autoFocus={comment.body === '' ? true : undefined}
                    onSubmit={(value: string) => { void editComment($, rendered as Rendered, comment.id, 'edit', value) }} />
                  <Button key={`delete:${comment.id}`} label="Delete" plain onPress={() => { void editComment($, rendered as Rendered, comment.id, 'delete') }} />
                </Box>
              )
              : <Button key={`restore:${comment.id}`} label="Restore" plain onPress={() => { void editComment($, rendered as Rendered, comment.id, 'restore') }} />}
          </Box>
        ))}
        {live.length > 0 && (
          <Box marginTop={1}>
            <Button key="send" variant="primary" label={`Send review · ${live.length}`} onPress={() => { void sendDraft($, rendered as Rendered) }} />
          </Box>
        )}
        {(snapshot?.batches ?? []).slice(0, 3).map(batch => batchRow($, batch, { Box, Text, Button }))}
      </Box>
    )
  })
}
