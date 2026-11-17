/**
 * Per-session folders inside a workspace.
 *
 * A workspace is one directory shared by every session created in it, so two
 * engagements in the same workspace used to write the same `./loot/` and the
 * same report file. This service gives each top-level session its own folder,
 * `<workspace>/<folder>/<session-title-slug>/`, and the shell and filesystem
 * tools start there: commands run in it and relative paths resolve against
 * it. The session's recorded `cwd` stays the workspace itself, so workspace
 * membership, the sandbox root, and cross-session queries are unchanged, and
 * the agent can still reach the rest of the workspace by path.
 *
 * The folder is chosen the first time a tool needs it, once the session has a
 * title, and is then pinned: a `.dsh-session` marker inside it records the
 * owning session id, so a renamed session or a restarted harness keeps using
 * the same folder. A subagent or fork shares its parent's folder. Sessions that
 * existed before this service started and have no marker keep working in the
 * workspace root, so an engagement already under way does not move mid-run.
 * @module @pentest-harness/dsh-session-folders
 */

import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { Service } from '@pentest-harness/cordis'
import type { Context } from '@pentest-harness/cordis'
import z from '@pentest-harness/schemastery'
import type { Agent } from '@pentest-harness/dsh-agent'
import type { Session, SessionId } from '@pentest-harness/dsh-session'
import { installSettingsSection, settingsNamespace } from '@pentest-harness/dsh-settings'
// Type-only: the optional title and prompt services this one reads through `ctx.get`.
import type {} from '@pentest-harness/dsh-session-title'
import type {} from '@pentest-harness/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'session-folders'

/** File inside a session folder that records which session owns it. */
export const MARKER_FILE = '.dsh-session'

/** Settings namespace the Plugins settings page edits. */
export const SESSION_FOLDERS_SETTINGS_NAMESPACE = settingsNamespace('session-folders')

/** The user-editable part of the configuration. */
export interface SessionFolderSettings {
  /** Give each new session its own folder. */
  enabled: boolean
  /** Parent folder, relative to the workspace, that holds the session folders. */
  folder: string
}

/** Plugin configuration. */
export interface Config extends Partial<SessionFolderSettings> {
  /** How long to wait for a model-written title before naming the folder from the fallback title. */
  titleWaitMs?: number
  /** Register the `session-folders` settings namespace so the settings page can edit it. */
  settings?: boolean
}

const DEFAULT_FOLDER = 'sessions'
const DEFAULT_TITLE_WAIT_MS = 15_000
const MAX_SLUG_LENGTH = 60

/** Schema of the settings namespace. */
export const SESSION_FOLDERS_SETTINGS_SCHEMA: z<SessionFolderSettings> = z.object({
  enabled: z.boolean().default(true),
  folder: z.string().default(DEFAULT_FOLDER),
})

declare module '@pentest-harness/cordis' {
  interface Context {
    sessionFolders: SessionFolders
  }
}

/**
 * Reject a parent folder that would leave the workspace or name nothing.
 * @param folder - the configured parent folder.
 * @returns the folder, trimmed.
 */
export function validateFolder(folder: string): string {
  const trimmed = folder.trim()
  if (trimmed === '') throw new Error('session-folders: folder must not be empty')
  if (isAbsolute(trimmed)) throw new Error('session-folders: folder must be relative to the workspace')
  if (trimmed.split(/[\\/]/).some(part => part === '..')) {
    throw new Error('session-folders: folder must stay inside the workspace')
  }
  return trimmed
}

/**
 * Turn a session title into a folder name: lowercase ASCII words joined by
 * dashes, at most {@link MAX_SLUG_LENGTH} characters.
 * @param title - the session title.
 * @returns the slug, or the empty string when nothing usable remains.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= MAX_SLUG_LENGTH) return slug
  const cut = slug.slice(0, MAX_SLUG_LENGTH)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

/** Read the session id a folder's marker records, or undefined when there is none. */
async function markerOwner(dir: string): Promise<string | undefined> {
  try {
    return (await readFile(join(dir, MARKER_FILE), 'utf8')).trim()
  } catch {
    return undefined
  }
}

/** Find the folder under `parent` whose marker names `id`. */
async function findPinned(parent: string, id: string): Promise<string | undefined> {
  let names: string[]
  try {
    names = await readdir(parent)
  } catch {
    return undefined
  }
  for (const entry of names) {
    const dir = join(parent, entry)
    if (await markerOwner(dir) === id) return dir
  }
  return undefined
}

/** Whether `child` is `root` or lies inside it. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Assigns and pins one folder per top-level session. */
export class SessionFolders extends Service {
  /** Runtime schema for the plugin row. */
  static Config: z<Config> = z.object({
    enabled: z.boolean(),
    folder: z.string(),
    titleWaitMs: z.number().step(1).min(0),
    settings: z.boolean().default(false),
  })

  private source: () => SessionFolderSettings
  private readonly titleWaitMs: number
  private readonly startedAt = Date.now()
  /** Resolution per session id, shared by concurrent callers. */
  private readonly pending = new Map<SessionId, Promise<string | undefined>>()
  /** Settled folders, readable synchronously by the prompt context. */
  private readonly settled = new Map<SessionId, string | undefined>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionFolders')
    const entry: SessionFolderSettings = {
      enabled: config.enabled ?? true,
      folder: validateFolder(config.folder ?? DEFAULT_FOLDER),
    }
    this.titleWaitMs = config.titleWaitMs ?? DEFAULT_TITLE_WAIT_MS
    this.source = () => entry
    if (config.settings === true) {
      installSettingsSection(ctx, SESSION_FOLDERS_SETTINGS_NAMESPACE, SESSION_FOLDERS_SETTINGS_SCHEMA, entry, {
        validate: (value) => { validateFolder(value.folder) },
        setSource: (current) => { this.source = current },
        // Already-assigned sessions keep their folder; the next lookup reads the new values.
        onChange: () => {},
      })
    }
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.context({
        name: 'session-folder',
        order: 40,
        text: ({ agent }) => {
          if (agent === undefined || !this.settings().enabled) return ''
          const id = agent.session.header.id
          if (!this.settled.has(id)) {
            // Start the lookup so the next request can name the folder.
            void this.resolve(agent).catch(() => {})
            return ''
          }
          const dir = this.settled.get(id)
          return dir === undefined
            ? ''
            : `Session folder: ${dir}\nShell commands start here and relative file paths resolve here. `
              + 'Keep this session\'s loot, notes and report in it; the rest of the workspace is still reachable by path.'
        },
      })
    })
  }

  /** The settings currently in force (user layer over the plugin row). */
  settings(): SessionFolderSettings {
    return this.source()
  }

  /**
   * The folder an agent's tools should start in.
   * @param agent - the calling agent; a non-agent caller gets `undefined`.
   * @returns the session folder, or the session's workspace when folders are
   * off, the session has no workspace, or it predates this service.
   */
  async workdir(agent: Agent | undefined): Promise<string | undefined> {
    if (agent === undefined) return undefined
    return await this.resolve(agent) ?? agent.session.header.cwd
  }

  /**
   * Resolve (and on first use create) the session's own folder.
   * @param agent - the calling agent.
   * @returns the folder, or `undefined` when this session works in the workspace root.
   */
  async resolve(agent: Agent): Promise<string | undefined> {
    if (!this.settings().enabled) return undefined
    const session = agent.session
    const id = session.header.id
    let pending = this.pending.get(id)
    if (pending === undefined) {
      pending = this.assign(session).then((dir) => {
        this.settled.set(id, dir)
        return dir
      }, (error: unknown) => {
        this.pending.delete(id)
        throw error
      })
      this.pending.set(id, pending)
    }
    return await pending
  }

  private async assign(session: Session): Promise<string | undefined> {
    const { cwd, id, parentSession, createdAt } = session.header
    if (cwd === undefined) return undefined
    const parent = join(cwd, validateFolder(this.settings().folder))

    if (parentSession !== undefined) {
      const inherited = this.settled.get(parentSession) ?? await findPinned(parent, parentSession)
      if (inherited !== undefined) return inherited
    }
    const pinned = await findPinned(parent, id)
    if (pinned !== undefined) return pinned
    // A session that was already running before this service existed keeps
    // the workspace root, so its earlier files stay where it expects them.
    if (createdAt < this.startedAt && session.events.length > 0) return undefined

    const title = await this.waitForTitle(session)
    const base = slugify(title ?? '') || `session-${id.slice(-8)}`
    await mkdir(parent, { recursive: true })
    for (let attempt = 1; ; attempt++) {
      const dir = join(parent, attempt === 1 ? base : `${base}-${attempt}`)
      try {
        await mkdir(dir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (await markerOwner(dir) === id) return dir
        continue
      }
      await writeFile(join(dir, MARKER_FILE), `${id}\n`, 'utf8')
      return dir
    }
  }

  /**
   * The session's title, waiting a bounded time for a model-written one when
   * only the instant first-prompt fallback exists so far.
   */
  private async waitForTitle(session: Session): Promise<string | undefined> {
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) return undefined
    const current = titles.get(session)
    if (current !== undefined && current.source.kind !== 'fallback') return current.title
    if (this.titleWaitMs === 0) return current?.title
    return await new Promise<string | undefined>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        off()
        resolve(titles.get(session)?.title)
      }
      const timer = setTimeout(done, this.titleWaitMs)
      const off = this.ctx.on('session/event', (source, event) => {
        if (source === session && event.type === 'session/title' && event.data.source.kind !== 'fallback') done()
      })
    })
  }
}

/**
 * Resolve the directory a tool call should start in, preferring the session
 * folder when the service is mounted and the folder sits inside `root`.
 * @param ctx - the tool plugin's context; the service is optional.
 * @param agent - the calling agent.
 * @param root - the directory the tool would otherwise use (sandbox workspace root or session cwd).
 * @returns the session folder, or `root` unchanged.
 */
export async function toolWorkdir(ctx: Context, agent: Agent | undefined, root: string | undefined): Promise<string | undefined> {
  const service = ctx.get('sessionFolders')
  if (service === undefined || agent === undefined || root === undefined) return root
  const dir = await service.resolve(agent)
  if (dir === undefined) return root
  try {
    const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)])
    // A folder outside the root the tool confines to (another sandbox root,
    // a moved workspace) would make every command fail; keep the root then.
    if (!isInside(realRoot, realDir) || !(await stat(realDir)).isDirectory()) return root
    return dir
  } catch {
    return root
  }
}

export default SessionFolders
