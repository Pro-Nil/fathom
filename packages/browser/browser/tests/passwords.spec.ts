import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_URL, SharedBrowser } from '@fathom/browser'
import { encryptChromiumLinuxValue, parseCsv, parsePasswordCsv } from '../src/passwords.ts'

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\n\nlast,')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['last', '']])
  })
})

describe('parsePasswordCsv', () => {
  it('reads Chromium exports and skips rows without a web address or password', () => {
    const csv = 'name,url,username,password,note\nex,https://example.com/login,alice,pw1,\napp,android://x,bob,pw2,\nempty,https://a.test/,c,,\n'
    expect(parsePasswordCsv(csv)).toEqual({ logins: [{ url: 'https://example.com/login', username: 'alice', password: 'pw1' }], skipped: 2 })
  })
  it('reads Firefox exports by header name', () => {
    const csv = '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://b.test","bo","pw","","","{1}","1","1","1"\n'
    expect(parsePasswordCsv(csv).logins).toEqual([{ url: 'https://b.test', username: 'bo', password: 'pw' }])
  })
  it('refuses files that are not password exports', () => {
    expect(() => parsePasswordCsv('a,b\n1,2\n')).toThrow(/not a password export/u)
  })
})

describe('encryptChromiumLinuxValue', () => {
  it('writes v10 blobs that decrypt with the basic-store key', () => {
    const blob = encryptChromiumLinuxValue('s3cret pässword')
    expect(blob.subarray(0, 3).toString('latin1')).toBe('v10')
    const key = pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    expect(Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString('utf8')).toBe('s3cret pässword')
  })
})

// Real Chromium: import into a throwaway profile, reopen, and check the
// browser's own password manager lists the entries.
describe.runIf(process.platform === 'win32' || process.platform === 'linux')('SharedBrowser.importPasswords (real Chromium)', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'fathom-browser-pw-'))
  const browser = new SharedBrowser({ channel: 'chromium', headless: true, profileDir, width: 900, height: 700, searchUrl: DEFAULT_SEARCH_URL })
  afterAll(async () => {
    await browser.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('writes logins that Chromium can read back, and keeps existing ones on re-import', async () => {
    await browser.navigate('chrome://password-manager/passwords')
    const csv = 'name,url,username,password,note\nprobe,https://probe-one.test/login,probe-user,probe-pass-1,\nprobe2,https://probe-two.test/,other,probe-pass-2,\n'
    const file = { name: 'export.csv', mimeType: 'text/csv', data: Buffer.from(csv).toString('base64') }
    expect(await browser.importPasswords([file])).toEqual({ imported: 2, duplicates: 0, skipped: 0 })
    expect(await browser.importPasswords([file])).toEqual({ imported: 0, duplicates: 2, skipped: 0 })

    await browser.navigate('chrome://password-manager/passwords')
    const page = await browser.page()
    await page.waitForTimeout(1500)
    const list = await page.ariaSnapshot({ mode: 'ai' })
    expect(list).toContain('probe-one.test')
    expect(list).toContain('probe-two.test')
  }, 90_000)
})
