/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @fathom/repeat-tool-reminder
 */

import type { Context } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type { Agent, PreStepDecision } from '@fathom/agent'
import { createUserMessage } from '@fathom/llm'
import type { MessageSource } from '@fathom/llm'
import type { UserMessage } from '@fathom/session'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@fathom/tools'
import { installSettingsSection, settingsNamespace } from '@fathom/settings'

export const name = 'repeat-tool-reminder'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
  /**
   * Consecutive-FAILURE counts that trigger a failure-loop reminder (default
   * `[]`, disabled). Unlike `thresholds`, the arguments may differ between
   * calls: a run of tracked calls that each failed (`isError`, or a shell
   * result carrying a non-zero `[exit code: N]` marker) counts, and any
   * successful tracked call resets it. This catches the "tweak the payload and
   * retry" loop that identical-argument detection misses.
   */
  failureThresholds?: number[]
  /** Register the `repeat-tool-reminder` settings namespace so the settings page can edit both threshold lists. */
  settings?: boolean
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
  failureThresholds: z.array(z.number()).default([]),
  settings: z.boolean().default(false),
})

/** The user-editable part of the configuration. */
export interface RepeatToolReminderSettings {
  /** See {@link Config.thresholds}. */
  thresholds: number[]
  /** See {@link Config.failureThresholds}. */
  failureThresholds: number[]
}

/** Settings namespace the Plugins settings page edits. */
export const REPEAT_TOOL_REMINDER_SETTINGS_NAMESPACE = settingsNamespace('repeat-tool-reminder')

/** Schema of the settings namespace. */
export const REPEAT_TOOL_REMINDER_SETTINGS_SCHEMA: z<RepeatToolReminderSettings> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  failureThresholds: z.array(z.number()).default([]),
})

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/** The failure-loop reminder: the last N tracked calls all failed, whatever their arguments. */
function failureReminder(count: number, tools: string[]): string {
  return 'Failure loop detected:\n'
    + `- consecutive_failed_calls: ${count}\n`
    + `- tools: ${[...new Set(tools)].join(', ')}\n`
    + 'Your last attempts all failed. Stop retrying variations of the same idea. '
    + 'Re-read the latest error, state in one sentence why the approach is failing, '
    + 'then either switch to a materially different approach, gather the missing '
    + 'information first, or record the result as negative and move on.'
}

/** Matches a non-zero shell exit marker (`[exit code: 1]`, `[exit code: -1]`), never `[exit code: 0]`. */
const NONZERO_EXIT = /\[exit code: (?!0\])-?\d+\]/

/** Whether a settled tool result counts as a failure for the failure-loop chain. */
function failed(result: Readonly<ToolExecutionResult>): boolean {
  if (result.isError) return true
  return result.content.some(block => block.type === 'text' && NONZERO_EXIT.test(block.text))
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[], key = 'thresholds', allowEmpty = false): number[] {
  if (values.length === 0 && !allowEmpty) {
    throw new Error(`repeat-tool-reminder: \`${key}\` must not be empty`)
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid ${key} entry ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`repeat-tool-reminder: \`${key}\` must not contain duplicates`)
  }
  return [...values].sort((a, b) => a - b)
}

/** The threshold lists in force, validated and indexed for lookup. */
interface Limits {
  thresholds: number[]
  thresholdSet: ReadonlySet<number>
  failureThresholdSet: ReadonlySet<number>
}

/** Validate both lists fail-loud and index them. */
function resolveLimits(value: RepeatToolReminderSettings): Limits {
  const thresholds = validateThresholds(value.thresholds)
  return {
    thresholds,
    thresholdSet: new Set(thresholds),
    failureThresholdSet: new Set(validateThresholds(value.failureThresholds, 'failureThresholds', true)),
  }
}

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string
  count: number
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const entry: RepeatToolReminderSettings = {
    thresholds: config.thresholds as number[],
    failureThresholds: config.failureThresholds as number[],
  }
  // The settings page can change both lists while the harness runs; each call
  // reads the lists in force when it is observed.
  let limits = resolveLimits(entry)
  let source = (): RepeatToolReminderSettings => entry
  if (config.settings === true) {
    installSettingsSection(ctx, REPEAT_TOOL_REMINDER_SETTINGS_NAMESPACE, REPEAT_TOOL_REMINDER_SETTINGS_SCHEMA, entry, {
      validate: (value) => { resolveLimits(value) },
      setSource: (current) => { source = current },
      onChange: () => { limits = resolveLimits(source()) },
    })
  }
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }

  const chains = new WeakMap<Agent, Chain>()
  const failureChains = new WeakMap<Agent, string[]>()

  /**
   * Advance the calling agent's failure chain and return the failure-loop
   * reminder when its length hits a configured `failureThresholds` entry.
   * Arguments are ignored: only consecutive failure matters.
   */
  function observeFailure(exec: ToolExecution, result: Readonly<ToolExecutionResult>): UserMessage | undefined {
    const { failureThresholdSet } = limits
    if (failureThresholdSet.size === 0 || !exec.agent || !tracked(exec.name)) return undefined
    if (!failed(result)) {
      failureChains.delete(exec.agent)
      return undefined
    }
    const tools = [...failureChains.get(exec.agent) ?? [], exec.name]
    failureChains.set(exec.agent, tools)
    if (!failureThresholdSet.has(tools.length)) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: failureReminder(tools.length, tools) }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${tools.length} failed calls in a row` },
    })
  }

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Advance the calling agent's chain for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold.
   * Counting happens here — in post-execute — because denied calls also flow
   * through this waterfall (`ToolRuntime.execute` routes a deny through the
   * same pipeline), and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  function observe(exec: ToolExecution): UserMessage | undefined {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const canonical = canonicalize(exec.arguments)
    const key = JSON.stringify([exec.name, canonical])
    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })
    const { thresholds, thresholdSet } = limits
    if (!thresholdSet.has(count)) return undefined
    const text = count === thresholds[0]
      ? GENTLE_REMINDER
      : detailedReminder(exec.name, count, previewArguments(canonical, argumentsPreviewChars))
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${count}` },
    })
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder onto whatever came back — additionalContexts
  // rides both decision variants, so a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    // An identical-call reminder already tells the model to stop; send at most
    // one reminder per call so a loop never pays for two.
    // Both chains always advance; the identical-call reminder wins a tie.
    const repeatReminder = observe(exec)
    const failureLoopReminder = observeFailure(exec, result)
    const reminder = repeatReminder ?? failureLoopReminder
    const downstream = await next()
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // A user interjection changes the context; repetition across it is not a
  // loop. Pure reset hook: always delegates (attaching nothing, vetoing
  // nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      chains.delete(agent)
      failureChains.delete(agent)
    }
    return next()
  })
}
