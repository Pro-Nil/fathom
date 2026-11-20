/**
 * Import saved passwords into the shared browser's own password manager from
 * password-export CSV files (Chrome, Brave, Edge, Opera, Vivaldi, Firefox and
 * most password managers write one). Rows are encrypted with this browser's own
 * storage key and written to its `Login Data` store while it is closed, exactly
 * as Chromium stores a saved password. Other browsers' stores are never read.
 * @module @fathom/browser/src/passwords
 */

import { spawn } from 'node:child_process'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** One login parsed from an export. */
export interface ImportedLogin {
  readonly url: string
  readonly username: string
  readonly password: string
}

/** Outcome of one import. */
export interface PasswordImportResult {
  /** Logins written. */
  readonly imported: number
  /** Logins already present (same site and username), left unchanged. */
  readonly duplicates: number
  /** Rows without a usable http(s) URL or password. */
  readonly skipped: number
}

/**
 * Parse RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF).
 * @param text - the CSV text.
 * @returns rows of fields.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^﻿/u, '')
  for (let index = 0; index < source.length; index++) {
    const char = source[index] as string
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(cell => cell.length > 0))
}

/**
 * Read logins from a password-export CSV. Columns are found by header name, so
 * Chromium (`name,url,username,password,note`), Firefox
 * (`url,username,password,httpRealm,…`) and similar layouts all work.
 * @param text - the CSV text.
 * @returns the logins and the number of unusable rows.
 */
export function parsePasswordCsv(text: string): { logins: ImportedLogin[]; skipped: number } {
  const [header, ...rows] = parseCsv(text)
  if (header === undefined) return { logins: [], skipped: 0 }
  const names = header.map(cell => cell.trim().toLowerCase())
  const column = (...candidates: string[]): number => names.findIndex(name => candidates.includes(name))
  const urlAt = column('url', 'login_uri', 'website', 'origin', 'web site')
  const userAt = column('username', 'login_username', 'login', 'user name', 'email')
  const passAt = column('password', 'login_password')
  if (urlAt === -1 || passAt === -1) {
    throw new Error('this file is not a password export: it needs "url" and "password" columns')
  }
  const logins: ImportedLogin[] = []
  let skipped = 0
  for (const row of rows) {
    const url = (row[urlAt] ?? '').trim()
    const password = row[passAt] ?? ''
    if (password.length === 0 || !/^https?:\/\//iu.test(url)) {
      skipped++
      continue
    }
    try {
      new URL(url)
    } catch {
      skipped++
      continue
    }
    logins.push({ url, username: userAt === -1 ? '' : row[userAt] ?? '', password })
  }
  return { logins, skipped }
}

/**
 * Unwrap this browser's own storage key (DPAPI-protected, current Windows user).
 * @param profileDir - the browser's user-data directory.
 * @returns the 32-byte AES key.
 */
async function windowsStorageKey(profileDir: string): Promise<Buffer> {
  const statePath = join(profileDir, 'Local State')
  if (!existsSync(statePath)) throw new Error('the browser profile is not initialised yet; open the browser once and try again')
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as { os_crypt?: { encrypted_key?: string } }
  const wrapped = state.os_crypt?.encrypted_key
  if (wrapped === undefined) throw new Error('the browser has not created its password key yet; open the password manager once and try again')
  const blob = Buffer.from(wrapped, 'base64')
  if (blob.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('unexpected password key format in this browser profile')
  // The wrapped key goes in on stdin and the key comes back on stdout, so
  // neither ever appears on a command line.
  const script = '$in=[Console]::In.ReadToEnd().Trim();Add-Type -AssemblyName System.Security;'
    + '$k=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in),$null,\'CurrentUser\');'
    + '[Console]::Out.Write([Convert]::ToBase64String($k))'
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`could not unlock the browser's password key: ${err.trim().split('\n')[0] ?? `exit ${String(code)}`}`))
    })
    child.stdin.end(blob.subarray(5).toString('base64'))
  })
  const key = Buffer.from(output, 'base64')
  if (key.length !== 32) throw new Error('the browser password key has an unexpected length')
  return key
}

/**
 * Encrypt one password the way Chromium's os_crypt does on Windows (`v10`,
 * AES-256-GCM, 12-byte nonce, 16-byte tag).
 * @param key - the browser's storage key.
 * @param plaintext - the password.
 * @returns the stored blob.
 */
export function encryptChromiumValue(key: Buffer, plaintext: string): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('v10', 'latin1'), nonce, body, cipher.getAuthTag()])
}

/**
 * The key Chromium on Linux uses with its basic (keyring-less) password store,
 * which Playwright selects with `--password-store=basic`: PBKDF2-SHA1 of the
 * fixed password "peanuts" with salt "saltysalt", one iteration, 16 bytes.
 */
const LINUX_BASIC_KEY = pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')

/**
 * Encrypt one password the way Chromium's os_crypt does on Linux with the
 * basic store (`v10`, AES-128-CBC, an IV of 16 spaces, PKCS#7 padding).
 * @param plaintext - the password.
 * @returns the stored blob.
 */
export function encryptChromiumLinuxValue(plaintext: string): Buffer {
  const cipher = createCipheriv('aes-128-cbc', LINUX_BASIC_KEY, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10', 'latin1'), cipher.update(plaintext, 'utf8'), cipher.final()])
}

/** Encrypts passwords for one profile; dispose wipes any unwrapped key. */
interface StorageCipher {
  encrypt(plaintext: string): Buffer
  dispose(): void
}

/**
 * This browser's password encryption on the current platform.
 * @param profileDir - the browser's user-data directory.
 * @returns the cipher.
 */
async function storageCipher(profileDir: string): Promise<StorageCipher> {
  if (process.platform === 'win32') {
    const key = await windowsStorageKey(profileDir)
    return { encrypt: plaintext => encryptChromiumValue(key, plaintext), dispose: () => { key.fill(0) } }
  }
  if (process.platform === 'linux') return { encrypt: encryptChromiumLinuxValue, dispose: () => {} }
  throw new Error(`password import is available on Windows and Linux only (this host is ${process.platform})`)
}

/** Microseconds since 1601-01-01, Chromium's timestamp base. */
function chromiumNow(): bigint {
  return (BigInt(Date.now()) + 11_644_473_600_000n) * 1000n
}

/**
 * Write logins into a closed Chromium profile's password store.
 * @param profileDir - the browser's user-data directory (browser must be closed).
 * @param logins - logins to add.
 * @returns how many were written and how many already existed.
 */
export async function writeLogins(profileDir: string, logins: readonly ImportedLogin[]): Promise<{ imported: number; duplicates: number }> {
  const dbPath = join(profileDir, 'Default', 'Login Data')
  if (!existsSync(dbPath)) throw new Error('the browser profile has no password store yet; open the browser once and try again')
  const cipher = await storageCipher(profileDir)
  const db = new DatabaseSync(dbPath)
  try {
    const insert = db.prepare(`INSERT OR IGNORE INTO logins (
      origin_url, action_url, username_element, username_value, password_element, password_value,
      submit_element, signon_realm, date_created, blacklisted_by_user, scheme, password_type, times_used,
      date_last_used, date_password_modified
    ) VALUES (?, '', '', ?, '', ?, '', ?, ?, 0, 0, 0, 0, 0, ?)`)
    let imported = 0
    const now = chromiumNow()
    db.exec('BEGIN')
    try {
      for (const login of logins) {
        const url = new URL(login.url)
        const origin = `${url.protocol}//${url.host}/`
        const result = insert.run(`${origin}${url.pathname.replace(/^\//u, '')}`, login.username, cipher.encrypt(login.password), origin, now, now)
        imported += Number(result.changes)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { imported, duplicates: logins.length - imported }
  } finally {
    db.close()
    cipher.dispose()
  }
}
