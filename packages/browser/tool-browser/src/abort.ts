/**
 * Cancellation for browser tools. The tool registry never abandons a running
 * tool body: Stop (and any tool-call timeout policy) only aborts `exec.signal`
 * and then waits for the body to settle. Playwright calls such as
 * `page.evaluate` ignore that signal and `evaluate` has no deadline, so a page
 * script awaiting a promise that never settles (a socket ack, a fetch to a
 * silent host) used to hold the whole turn, Stop included.
 * @module @fathom/tool-browser/src/abort
 */

/** Default deadline for a `browser_javascript` script, in milliseconds. */
export const SCRIPT_TIMEOUT_MS = 30_000

/** Marker the in-page deadline rejects with, recognized on the Node side. */
export const SCRIPT_TIMEOUT_MARKER = '__fathom_script_timeout__'

/** The error a tool settles with when the user stops the turn. */
export function stoppedError(): Error {
  return new Error('Stopped: the user cancelled this call before it finished.')
}

/**
 * Settle with `work`, or reject as soon as `signal` aborts. The abandoned
 * promise keeps a rejection handler so its later failure is not unhandled.
 * @param work - the pending browser operation.
 * @param signal - the call's cancellation signal.
 */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined)
    return Promise.reject(stoppedError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(stoppedError()) }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Wrap model-written code so the page itself gives up after `timeoutMs`: the
 * evaluate call then settles inside the browser and nothing is left pending.
 * @param code - the model's expression or statements.
 * @param form - `expression` returns the value of one expression; `statements` needs an explicit return.
 * @param timeoutMs - in-page deadline.
 */
export function pageScript(code: string, form: 'expression' | 'statements', timeoutMs: number): string {
  const body = form === 'expression' ? `(async () => (${code}\n))()` : `(async () => {\n${code}\n})()`
  return `Promise.race([${body}, new Promise((_, reject) => setTimeout(() => reject(new Error(${JSON.stringify(SCRIPT_TIMEOUT_MARKER)})), ${String(timeoutMs)}))])`
}

/** The message a model gets when its script hit the deadline. */
export function scriptTimeoutMessage(timeoutMs: number): string {
  return `The script did not finish within ${String(timeoutMs / 1000)}s: something it awaited never settled (a socket ack or event `
    + 'that never came, a request to a silent host). Bound your waits, e.g. Promise.race with a short timeout, or start the work, '
    + 'store results on window, return at once and read them with a second browser_javascript call.'
}
