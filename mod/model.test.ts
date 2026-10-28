import { expect, test } from 'claude-code/testing'
import { batchIdIn, excerpt, initSummary, splitLines } from './model.ts'

test('watcher output split across pieces yields whole lines only', () => {
  const first = splitLines('', '{"a":1}\n{"b"')
  expect(first).toEqual({ lines: ['{"a":1}'], rest: '{"b"' })
  expect(splitLines(first.rest, ':2}\n\n')).toEqual({ lines: ['{"b":2}'], rest: '' })
})

test('a batch id is read only from the marker', () => {
  expect(batchIdIn('<grind-review batch=b-20261026-ab12cd34 comments=2 init=x>')).toBe('b-20261026-ab12cd34')
  expect(batchIdIn('talks about grind-review without a marker')).toBeNull()
  expect(batchIdIn('grind-review batch=; rm -rf')).toBeNull()
})

test('the init summary tells explicit, inferred, missing and ambiguous inits apart', () => {
  expect(initSummary({ state: 'resolved', initiative: 'demo', source: 'explicit', currentTask: null }, 0)).toBe('demo [bound]')
  expect(initSummary({ state: 'resolved', initiative: 'demo', source: 'branch', currentTask: 'x'.repeat(60) }, 2)).toBe(`demo [branch] · ${'x'.repeat(47)}… · review 2`)
  expect(initSummary({ state: 'ambiguous', candidates: ['a', 'b'] }, 0)).toBe('init ambiguous (a, b)')
  expect(initSummary({ state: 'none', reason: 'none' }, 1)).toBe('no init · review 1')
  expect(initSummary({ state: 'unavailable', reason: 'broken' }, 0)).toBe('init unavailable')
})

test('excerpts mark what they leave out and never carry control characters', () => {
  expect(excerpt('one\ntwo\nthree', 2, 10)).toBe('one\ntwo\n… 1 more line(s)')
  expect(excerpt('abcdefghijkl', 1, 5)).toBe('abcd…')
  expect(excerpt('a\u001b[2Jb', 1, 20)).toBe('a�[2Jb')
})
