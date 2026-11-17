/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each session's
 * `read`/`write`/`edit` act on ITS workspace, not the server's launch dir — mirroring how
 * `dsh-tool-bash` defaults a bash `workdir` to the session cwd.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @pentest-harness/dsh-tool-fs/session-cwd
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@pentest-harness/cordis'
import type { ToolExecution } from '@pentest-harness/dsh-tools'
import { canonicalPath } from '@pentest-harness/dsh-sandbox'
import { toolWorkdir } from '@pentest-harness/dsh-session-folders'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools. Relative
 * paths resolve in the session's own folder when one is assigned inside the
 * root, so the file tools and the shell agree on where `./loot/` is.
 * @param ctx - the tool plugin's context; the session-folders service is optional.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export async function sessionResolveOptions(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): Promise<{ cwd?: string; signal?: AbortSignal }> {
  const root = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  const cwd = isAbsolute(requestedPath) ? root : await toolWorkdir(ctx, exec.agent, root)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
