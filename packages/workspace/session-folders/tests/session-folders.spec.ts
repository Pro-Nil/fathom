import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@pentest-harness/cordis'
import type { Agent } from '@pentest-harness/dsh-agent'
import SessionFolders, {
  MARKER_FILE, isInside, slugify, toolWorkdir, validateFolder,
} from '@pentest-harness/dsh-session-folders'

const dirs: string[] = []
function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'session-folders-')))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A stand-in agent: only the session header and event count are read. */
function agent(header: { id: string; cwd?: string; createdAt?: number; parentSession?: string }, events = 0): Agent {
  return {
    session: {
      header: { version: 1, createdAt: Date.now() + 1000, ...header },
      events: Array.from({ length: events }),
    },
  } as unknown as Agent
}

/** A stand-in title service returning a fixed model-written title. */
function titles(ctx: Context, title: string | undefined): void {
  void new (class extends Service {
    constructor(inner: Context) {
      super(inner, 'sessionTitle')
    }

    get() {
      return title === undefined ? undefined : { title, source: { kind: 'provider' } }
    }
  })(ctx)
}

describe('slugify', () => {
  it('turns a title into a lowercase dashed folder name', () => {
    expect(slugify('Gradescope Vulnerability Hunt')).toBe('gradescope-vulnerability-hunt')
    expect(slugify('  Café: API / Auth?? ')).toBe('cafe-api-auth')
    expect(slugify('漢字')).toBe('')
  })

  it('cuts long titles at a word boundary', () => {
    const slug = slugify('one two three four five six seven eight nine ten eleven twelve thirteen')
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('validateFolder and isInside', () => {
  it('rejects folders that leave the workspace', () => {
    expect(validateFolder(' sessions ')).toBe('sessions')
    expect(() => validateFolder('')).toThrow(/empty/)
    expect(() => validateFolder('../out')).toThrow(/inside/)
    expect(() => validateFolder(join(tmpdir(), 'x'))).toThrow(/relative/)
  })

  it('treats the root itself and its children as inside', () => {
    const root = workspace()
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join(root, 'a', 'b'))).toBe(true)
    expect(isInside(root, join(root, '..', 'other'))).toBe(false)
  })
})

describe('SessionFolders', () => {
  it('creates a title-named folder with a marker and reuses it', async () => {
    const root = workspace()
    const ctx = new Context()
    titles(ctx, 'Gradescope Vulnerability Hunt')
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })
    const caller = agent({ id: 'session-aaaa1111', cwd: root })

    const dir = await service.resolve(caller)
    expect(dir).toBe(join(root, 'sessions', 'gradescope-vulnerability-hunt'))
    expect(readFileSync(join(dir!, MARKER_FILE), 'utf8').trim()).toBe('session-aaaa1111')
    expect(await service.resolve(caller)).toBe(dir)
  })

  it('suffixes a name another session already owns', async () => {
    const root = workspace()
    const taken = join(root, 'sessions', 'recon')
    mkdirSync(taken, { recursive: true })
    writeFileSync(join(taken, MARKER_FILE), 'someone-else\n')
    const ctx = new Context()
    titles(ctx, 'Recon')
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })

    expect(await service.resolve(agent({ id: 's-2', cwd: root }))).toBe(join(root, 'sessions', 'recon-2'))
  })

  it('finds a pinned folder again after a restart, even if the title changed', async () => {
    const root = workspace()
    const pinned = join(root, 'sessions', 'old-title')
    mkdirSync(pinned, { recursive: true })
    writeFileSync(join(pinned, MARKER_FILE), 's-3\n')
    const ctx = new Context()
    titles(ctx, 'New Title')
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })

    expect(await service.resolve(agent({ id: 's-3', cwd: root, createdAt: 1 }, 10))).toBe(pinned)
  })

  it('shares the parent folder with a subagent or fork', async () => {
    const root = workspace()
    const ctx = new Context()
    titles(ctx, 'Parent Work')
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })
    const parent = await service.resolve(agent({ id: 'p-1', cwd: root }))

    expect(await service.resolve(agent({ id: 'c-1', cwd: root, parentSession: 'p-1' }))).toBe(parent)
  })

  it('leaves sessions that predate the service in the workspace root', async () => {
    const root = workspace()
    const ctx = new Context()
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })

    expect(await service.resolve(agent({ id: 'old', cwd: root, createdAt: 1 }, 5))).toBeUndefined()
    expect(await service.workdir(agent({ id: 'old', cwd: root, createdAt: 1 }, 5))).toBe(root)
  })

  it('falls back to a short id when there is no title, and does nothing when disabled', async () => {
    const root = workspace()
    const ctx = new Context()
    const service = new SessionFolders(ctx, { titleWaitMs: 0 })
    expect(await service.resolve(agent({ id: 'abcdefgh12345678', cwd: root })))
      .toBe(join(root, 'sessions', 'session-12345678'))

    const off = new SessionFolders(new Context(), { enabled: false })
    expect(await off.resolve(agent({ id: 'x', cwd: root }))).toBeUndefined()
  })
})

describe('toolWorkdir', () => {
  it('returns the session folder inside the root, and the root without the service', async () => {
    const root = workspace()
    const ctx = new Context()
    titles(ctx, 'Shell Start')
    void new SessionFolders(ctx, { titleWaitMs: 0 })
    const caller = agent({ id: 's-9', cwd: root })

    expect(await toolWorkdir(ctx, caller, root)).toBe(join(root, 'sessions', 'shell-start'))
    expect(await toolWorkdir(new Context(), caller, root)).toBe(root)
    expect(await toolWorkdir(ctx, undefined, root)).toBe(root)
  })

  it('keeps the root when the folder lies outside it', async () => {
    const root = workspace()
    const other = workspace()
    const ctx = new Context()
    titles(ctx, 'Elsewhere')
    void new SessionFolders(ctx, { titleWaitMs: 0 })

    expect(await toolWorkdir(ctx, agent({ id: 's-10', cwd: root }), other)).toBe(other)
  })
})
