import { describe, expect, it } from 'vitest'
import { pageScript, SCRIPT_TIMEOUT_MARKER, untilAborted } from '../src/abort.ts'

/** Evaluate a page script the way the page would: as one expression. */
const evaluate = (script: string): Promise<unknown> => (0, eval)(script) as Promise<unknown>

describe('untilAborted', () => {
  it('settles with the work when not cancelled', async () => {
    await expect(untilAborted(Promise.resolve(7), new AbortController().signal)).resolves.toBe(7)
  })

  it('rejects at once when Stop aborts a call that would never settle', async () => {
    const controller = new AbortController()
    const pending = untilAborted(new Promise<never>(() => undefined), controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('Stopped')
  })

  it('rejects immediately when already aborted, without an unhandled rejection from the work', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(untilAborted(Promise.reject(new Error('late')), controller.signal)).rejects.toThrow('Stopped')
  })
})

describe('pageScript', () => {
  it('returns an expression value and supports statements with return', async () => {
    await expect(evaluate(pageScript('1 + 2', 'expression', 1000))).resolves.toBe(3)
    await expect(evaluate(pageScript('const a = 2\nreturn a * 5', 'statements', 1000))).resolves.toBe(10)
  })

  it('gives up inside the page when an awaited promise never settles (the stuck socket ack)', async () => {
    const script = pageScript('await new Promise(() => {})', 'expression', 50)
    await expect(evaluate(script)).rejects.toThrow(SCRIPT_TIMEOUT_MARKER)
  })
})
