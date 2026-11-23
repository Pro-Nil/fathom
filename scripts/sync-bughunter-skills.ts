/**
 * Vendor a curated, pinned subset of the Claude-BugHunter skills
 * (github.com/elementalsouls/Claude-BugHunter, skill content CC BY 4.0) into
 * packages/pentest/bounty-skills/skills. The commit is pinned so upstream
 * changes never reach the agent's instructions without a reviewed bump:
 * change PINNED_COMMIT, run `tsx scripts/sync-bughunter-skills.ts`, review the
 * diff, commit.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'elementalsouls/Claude-BugHunter'
export const PINNED_COMMIT = '6a530fb3149c8c34d3ba0eb31b4eb431e91da648'

/**
 * Web and API bug bounty skills. Left out: enterprise red-team chains (M365,
 * Okta, vCenter, VPN, SharePoint), mobile pipelines, web3, OSINT tooling with
 * scripts, the harness-specific local toolkit, and the red-team
 * evasion/IR-detection material, none of which belongs in a bug bounty mode.
 */
export const SKILLS = [
  // Method, triage, reporting
  'bb-methodology', 'bug-bounty', 'recon-scope-triage', 'web2-recon', 'triage-validation',
  'report-writing', 'bugcrowd-reporting', 'evidence-hygiene', 'hunt-dispatch', 'security-arsenal',
  // Access control and identity: where hunters beat scanners
  'hunt-idor', 'hunt-auth-bypass', 'hunt-ato', 'hunt-business-logic', 'hunt-race-condition',
  'hunt-oauth', 'hunt-saml', 'hunt-session', 'hunt-mfa-bypass', 'hunt-forgot-password',
  'hunt-jwt-crypto', 'hunt-captcha-bypass', 'hunt-brute-force',
  // APIs and modern stacks
  'hunt-api-misconfig', 'hunt-shadow-api', 'hunt-spa-api', 'hunt-graphql', 'hunt-grpc',
  'hunt-websocket', 'hunt-nextjs', 'hunt-nodejs', 'hunt-springboot', 'hunt-laravel', 'hunt-aspnet',
  'hunt-llm-ai', 'hunt-rag-vector',
  // Server-side and infrastructure
  'hunt-ssrf', 'hunt-rce', 'hunt-sqli', 'hunt-nosqli', 'hunt-ssti', 'hunt-xxe', 'hunt-lfi',
  'hunt-deserialization', 'hunt-file-upload', 'hunt-http-smuggling', 'hunt-cache-poison',
  'hunt-host-header', 'hunt-subdomain', 'hunt-source-leak', 'hunt-cloud-misconfig', 'hunt-cicd',
  // Client-side
  'hunt-xss', 'hunt-dom', 'hunt-cors', 'hunt-csrf', 'hunt-open-redirect', 'hunt-html-injection',
  'hunt-clickjacking', 'hunt-exceptional-conditions', 'hunt-misc',
] as const

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'pentest', 'bounty-skills', 'skills')

async function main(): Promise<void> {
  await rm(root, { recursive: true, force: true })
  let bytes = 0
  for (const skill of SKILLS) {
    const url = `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/skills/${skill}/SKILL.md`
    const response = await fetch(url, { headers: { 'user-agent': 'fathom-skill-sync' } })
    if (!response.ok) throw new Error(`${skill}: GitHub answered ${response.status.toString()} for ${url}`)
    // Whitespace only: trailing spaces and extra blank lines at the end are
    // dropped to meet the repository's whitespace check. No other change.
    const raw = (await response.text()).replace(/\r\n/gu, '\n')
    const text = `${raw.split('\n').map(line => line.trimEnd()).join('\n').trimEnd()}\n`
    if (!text.startsWith('---\n')) throw new Error(`${skill}: SKILL.md has no frontmatter`)
    await mkdir(join(root, skill), { recursive: true })
    await writeFile(join(root, skill, 'SKILL.md'), text)
    bytes += text.length
  }
  console.log(`sync-bughunter-skills: wrote ${SKILLS.length.toString()} skills (${Math.round(bytes / 1024).toString()} KB) from ${REPO}@${PINNED_COMMIT.slice(0, 8)}`)
}

await main()
