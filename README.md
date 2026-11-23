<div align="center">

<img src="docs/images/fathom-banner.png" alt="Fathom" width="100%" />

**An AI agent workspace for authorized security testing.**

Bring any model. Fathom gives it a shell, a real browser, a pentest toolkit, scope guardrails and an evidence-first way of working, in a local web UI or a desktop app for Windows and Linux.

[Quick start](#quick-start) · [Walkthrough](#a-session-from-start-to-finish) · [Features](#features) · [Configuration](#configuration) · [Documentation](#documentation)

</div>

<img src="docs/images/findings.png" alt="A finished Fathom session: four verified findings with severity tiles, and the selected finding's root cause, impact and reproduction steps" width="100%" />

<sub>A real Pentest Mode run against a deliberately vulnerable lab app on `127.0.0.1`: four findings, each with recorded HTTP evidence, a root cause and reproduction steps.</sub>

---

## Contents

- [What Fathom is](#what-fathom-is)
- [Quick start](#quick-start)
- [A session from start to finish](#a-session-from-start-to-finish)
- [Features](#features)
- [Configuration](#configuration)
- [Where your data lives](#where-your-data-lives)
- [How it is built](#how-it-is-built)
- [Documentation](#documentation)
- [Use it responsibly](#use-it-responsibly)
- [License](#license)

## What Fathom is

Fathom runs an AI agent on your own machine and points it at targets you are allowed to test: your own apps, client engagements, bug bounty programs, labs and CTFs. You describe the job in plain language; the agent plans, runs tools, records what it finds and writes the report, while you watch every step and can stop, steer or take over at any time.

It is built for long, real engagements, not demos:

- **Evidence, not claims.** Every request the agent sends through `http_request` is saved as numbered traffic (`T1`, `T2`, …), and findings are bound to that traffic. Reports quote the real request and response.
- **Scope is enforced, not suggested.** Once a scope is declared, commands and requests aimed at anything outside it are refused before they run.
- **Nothing is forgotten.** Assets, tried and ruled-out attack paths, findings and notes are kept as files in the session folder, so they survive context compaction, resume and fork.
- **Any model, keys stay local.** OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, Azure, Bedrock, Vertex, or any OpenAI-compatible gateway. Keys live in an owner-only file under `~/.fathom`, never in settings or logs.

## Quick start

You need Git, [Node.js](https://nodejs.org) 20 or newer (22 recommended) and pnpm (`npm i -g pnpm`).

```sh
git clone https://github.com/Pro-Nil/fathom.git
cd fathom
pnpm install
pnpm build
pnpm fathom web
```

Then:

1. Open **http://127.0.0.1:2323** (use `pnpm fathom web --port 3000` for another port).
2. Go to **Settings → Models**, choose **Add provider**, paste an API key, and save. For a self-hosted model or a gateway, choose **Add a custom provider** instead ([details](docs/guide/models.md)).
3. Add a **workspace**: the folder the agent works in. Put a `SCOPE.md` with your rules of engagement there.
4. Pick **Pentest Mode** or **Bug Bounty Mode**, describe the job, and send.

Want the desktop app, Linux setup, or to update an existing install? **[docs/UPDATING.md](docs/UPDATING.md)** covers first installs (web or desktop, Windows or Linux), updates and troubleshooting.

<table>
<tr>
<td width="50%"><img src="docs/images/add-provider.png" alt="Settings, Models: Add provider form with a provider picker and API key field" /></td>
<td width="50%"><img src="docs/images/custom-provider.png" alt="Settings, Models: custom provider form with Provider ID, base URL, API protocol, context window and API key" /></td>
</tr>
<tr>
<td><sub><b>Add provider</b>: pick a provider from the catalog and paste its key; its endpoint and models are already known.</sub></td>
<td><sub><b>Add a custom provider</b>: any compatible endpoint (gateway, self-hosted server). <b>Fetch available models</b> reads the model list from it.</sub></td>
</tr>
</table>

## A session from start to finish

The screenshots below come from one real, unedited run. The target is a small, deliberately vulnerable "Acme Shop" API on `127.0.0.1:8088`, and the workspace holds a short `SCOPE.md`.

### 1. Choose a mode and describe the job

<img src="docs/images/modes.png" alt="Agent mode picker showing Pentest Mode and Bug Bounty Mode with their descriptions" width="420" align="right" />

The mode (agent preset) decides the agent's persona, workflow and tools:

- **Pentest Mode**: an engagement workflow. Recon first, then systematic testing, every finding proved and recorded, a report at the end.
- **Bug Bounty Mode**: reads the program policy first, hunts the classes scanners miss (access control, auth, business logic, new features), and writes submission-ready reports.

Both share the same toolset and the same 61 bug-class skills. You can duplicate either one and edit it, or let the agent draft a new preset, under **Settings → Agent presets**.

The composer also sets the session's **permission level** (Read Only, Workspace Write or Full access) and its **model**.

<br clear="right" />

### 2. The agent sets scope and starts recon

<img src="docs/images/session-start.png" alt="Session start: the prompt, then the agent reads SCOPE.md, calls set_scope, makes its first HTTP request and creates a loot directory" width="100%" />

It reads `SCOPE.md`, declares the scope with `set_scope` (from then on, anything outside `127.0.0.1:8088` is blocked), and starts mapping the app. Every step is a row you can expand: thinking, shell commands, file reads and edits, and tool calls.

### 3. The toolkit installs itself

<img src="docs/images/toolkit-install.png" alt="A question card asking how to install nmap, ffuf, nuclei, sqlmap and other tools: WSL Ubuntu (recommended), Windows native, or don't install now" width="100%" />

On the first pentest session Fathom asks once how to install its toolkit of 31 tools (nmap, ffuf, nuclei, sqlmap, httpx, subfinder, katana, gobuster, hydra, testssl and more), then installs it in the background **while the agent keeps working**. On Windows it uses WSL Ubuntu or native Windows builds; on Linux it installs natively. Release downloads are checked against their published SHA-256 digests. The answer is saved, and later sessions install whatever is missing without asking.

### 4. Every finding is proved with recorded traffic

<img src="docs/images/tool-call-evidence.png" alt="An expanded http_request tool call: alice's token is used to read invoice 1001, which belongs to admin; the response is recorded as traffic T11" width="100%" />

Expanding a row shows exactly what was sent and received. Here the agent uses Alice's token to read invoice `1001`, which belongs to the admin. The exchange is saved as `T11` and attached to the IDOR finding as evidence.

### 5. A second agent checks the work

The agent then starts a **validator subagent** that re-tests each finding on its own. In this run it caught an overstatement: the first write-up said the SQL injection gave admin access, but the admin token it returns is never accepted by the API. The finding went from high to medium and was rewritten. Severity in a Fathom report is what was reproduced, not what was hoped for.

### 6. Report

<img src="docs/images/final-report.png" alt="The agent's closing summary: assessment complete, recon notes, confirmed findings and root-cause fixes" width="100%" />

`write_report` renders the findings store into `findings-report.md`, `findings-report.json` and a self-contained `findings-report.html` dashboard; Bug Bounty Mode can also write one submission-ready file per finding. The **Findings** bar under the conversation (shown at the top of this page) lists every finding with severity counts. Selecting one shows how it was found, why it happens, how to reproduce it and how to fix it.

### 7. See the whole run

<img src="docs/images/workflow.png" alt="The Workflow tab: a live run-flow graph of the session's stages with the latest reasoning panel" width="100%" />

Besides **Chat**, each session has a **Trajectory** tab (every model turn and tool call in a searchable table with timings) and a **Workflow** tab (a live graph of the run). The footer shows turns, steps, model and tool time, time to first token, cache hit rate and token use. **Session log** downloads the whole session.

## Features

### Pentest and bug bounty workflow

| | |
|---|---|
| **Agent presets** | Pentest Mode and Bug Bounty Mode ship built in. A preset is a full plugin composition (prompt, tools, skills, workflow), so you can copy one and change it, or build your own. |
| **61 bug-class skills** | Method and triage, reporting, and one `hunt-*` skill per class: IDOR, auth bypass, ATO, OAuth, SAML, MFA, JWT, SSRF, RCE, SQLi, NoSQLi, SSTI, XXE, XSS, CSRF, CORS, GraphQL, gRPC, WebSocket, LLM features, framework-specific skills and more. The agent loads the one it needs. ([bounty-skills](packages/pentest/bounty-skills/README.md)) |
| **Engagement memory** | An asset graph of the target side; an exploration graph of what was tried, what it yielded and what is ruled out; and an engagement map that shows which asset × bug-class pairs are still untested. ([tool-engagement](packages/pentest/tool-engagement/README.md)) |
| **Findings store** | `record_finding`, `update_finding`, `list_findings` and `write_report`, with CWE, threat model, reproduction, impact, remediation and bound traffic. ([tool-findings](packages/pentest/tool-findings/README.md)) |
| **Pentest toolkit** | 31 tools installed and kept available by the harness (WSL Ubuntu, Windows native, or Linux). ([pentest-toolkit](packages/pentest/pentest-toolkit/README.md)) |

### Guardrails

The [pentest guard](packages/pentest/pentest-guard/README.md) sits in front of every tool call:

- **Scope gate**: shell commands, `http_request`, browser navigation and web fetches are scanned for hosts, IPs and CIDRs. Out-of-scope targets are refused, and widening the scope asks you.
- **Approval rules**: online brute force, sqlmap OS shells, Metasploit and similar ask first; DoS tooling and destructive commands are denied.
- **Noise governor**: flags loud scanner settings (`nmap -T5`, unbounded `ffuf`, `nuclei` without a rate limit) and caps requests per host per minute.
- **Prompt-injection framing**: target output that tries to instruct the agent ("ignore previous instructions", fake system tags) is wrapped as untrusted, and the agent is told not to act on it.

On top of that, each session runs at a **permission level**: Read Only, Workspace Write, or Full access.

### A browser you share with the agent

<img src="docs/images/shared-browser.png" alt="The Browser panel open beside the conversation, showing the lab app's search page rendering injected HTML" width="100%" />

The agent drives a real Chromium, and you see the same browser in the **Browser** panel. Each session gets its own tab. You can take over at any time, for example to solve a CAPTCHA or sign in, then hand control back.

### Long sessions

- Sessions are saved as they run and can be resumed, renamed, searched and forked.
- Context is compacted automatically as it fills. Scope, assets, findings and the finished-work ledger live in files, so nothing important is lost.
- **Subagents** run focused jobs (like the validator above) in parallel, each with its own context.
- **Goals**, **plans**, **to-dos**, **schedules** and **background jobs** keep multi-hour work on track.
- When the agent needs you (a question, an approval, a plan to review), it asks in the conversation, and the desktop app sends a notification.

### Desktop app

A small native window around the same web UI, for Windows and Linux (Avalonia on .NET 10, using the system web view, so no extra Chromium). It starts the harness for you, hides to the tray, notifies you when a session needs input, and has an **Update** button that pulls, builds and restarts. Setup: [docs/UPDATING.md](docs/UPDATING.md) · details: [apps/desktop/README.md](apps/desktop/README.md).

### Other ways to run it

| | |
|---|---|
| `pnpm fathom web` | The web UI (the usual way to use Fathom). |
| `pnpm fathom --profile headless "job"` | One-shot: run a single job, print the answer, exit. |
| Python SDK | Drive the agent from Python: [docs/guide/python-sdk.md](docs/guide/python-sdk.md). |
| ACP / JSON-RPC | Embed the agent in an editor or another program: [examples/](examples/). |

All launch modes are described in [apps/cli/README.md](apps/cli/README.md).

## Configuration

Almost everything is set in the UI under **Settings** and saved to `~/.fathom/settings.yaml`. Changes apply without a restart.

<table>
<tr>
<td width="50%"><img src="docs/images/agent-presets.png" alt="Settings, Agent presets: Pentest Mode (in use) and Bug Bounty Mode built-in cards" /></td>
<td width="50%"><img src="docs/images/settings-plugins.png" alt="Settings, Plugins: Shell, Agent loop, Large tool output, Loop guards, Session folders and Web search sections" /></td>
</tr>
<tr>
<td><sub><b>Agent presets</b>: duplicate a built-in mode to make it your own, or let the agent draft one.</sub></td>
<td><sub><b>Plugins</b>: shell, agent loop, large-output handling, loop guards, session folders, web search engine and every other plugin's options.</sub></td>
</tr>
</table>

| What | Where |
|---|---|
| Models and API keys | **Settings → Models** · [guide](docs/guide/models.md) |
| Default mode, default permission level, appearance | **Settings → General** |
| Model for a session | The model picker in the composer |
| Plugin options (shell, web search, scope mode, noise limits, …) | **Settings → Plugins**, or **Open configuration file** · [every option](docs/config-catalog.md) |
| Agent modes | **Settings → Agent presets** |
| Data folder | `FATHOM_HOME` environment variable (default `~/.fathom`) |

## Where your data lives

Everything you own is outside the code checkout, so installing or updating Fathom never touches it.

| Path | Contents |
|---|---|
| `~/.fathom/settings.yaml` | Settings |
| `~/.fathom/.credentials.yaml` | API keys (owner-only file) |
| `~/.fathom/sessions/` | Session logs |
| `<workspace>/sessions/<session>/` | Per-session files: scope, findings, recorded traffic, notes, reports |
| `~/.fathom/tools/` | Installed pentest tools and the install choice |
| `~/.fathom/browser/` | The shared browser's profile |

## How it is built

Fathom is a plugin-based agent harness on [Cordis](docs/cordis-primer.md). The model adapter, tool registry, session log, agent loop, UI panels and pentest features are all plugins, composed at boot from profiles and bundles. There is no privileged core: any part can be replaced by mounting a different plugin.

```mermaid
flowchart LR
  UI["Web UI / desktop app"] <-->|RPC + events| Host["Fathom host<br/>Node.js on 127.0.0.1:2323"]
  Host --> Loop["Agent loop"]
  Loop <--> LLM["Model provider<br/>any API"]
  Loop --> Guard["Pentest guard<br/>scope · approvals · noise"]
  Guard --> Tools["Tools<br/>shell · files · http_request · browser<br/>web search · toolkit · subagents"]
  Tools --> Target["Target in scope"]
  Loop --> Store["Session store<br/>assets · findings · traffic · notes"]
```

| Path | Contents |
|---|---|
| `apps/cli` | The `fathom` command, the shipped profiles and the agent presets |
| `apps/web` | The web application and its end-to-end tests |
| `apps/desktop` | The desktop app (Windows and Linux) |
| `packages/` | Every plugin, grouped by capability (`core`, `llm`, `shell`, `browser`, `client`, `pentest`, …) |
| `packages/pentest/` | Pentest guard, toolkit, engagement memory, findings, bug-class skills |
| `vendor/` | Vendored Cordis framework |
| `native/` | Landlock sandbox launcher for Linux |
| `python/` | Python SDK and its runtime |
| `examples/` | Headless, ACP and JSON-RPC example agents |
| `docs/` | Documentation (below) |

## Documentation

**Using Fathom**

- [Installing and updating](docs/UPDATING.md): web or desktop, Windows or Linux, updates, troubleshooting
- [Using the web UI](docs/guide/web-ui.md): workspaces, sessions, a first task
- [Configuring models](docs/guide/models.md): catalog and custom providers, image input, reasoning settings
- [Python SDK](docs/guide/python-sdk.md)
- [Command-line modes](apps/cli/README.md)
- Reference: [every configuration option](docs/config-catalog.md) · [every tool](docs/tool-catalog.md)

**Pentest features** (each README also shows what the model sees)

- [Pentest guard](packages/pentest/pentest-guard/README.md) · [Pentest toolkit](packages/pentest/pentest-toolkit/README.md) · [Engagement memory](packages/pentest/tool-engagement/README.md) · [Findings](packages/pentest/tool-findings/README.md) · [Bug-class skills](packages/pentest/bounty-skills/README.md)

**Extending and developing**

- [Development setup](docs/development.md) · [Testing](docs/testing.md) · [Contributing](CONTRIBUTING.md)
- [Architecture](docs/architecture.md) · [Glossary](docs/glossary.md) · [Subsystem references](docs/subsystems/README.md)
- [Cordis primer](docs/cordis-primer.md) · [Cordis tutorial](docs/cordis-tutorial/index.md) · [Cordis API](docs/cordis-api/context.md)
- Writing plugins: [your first plugin](docs/plugins/first-plugin.md) · [tools](docs/plugins/tool.md) · [configuration](docs/plugins/config.md) · [services](docs/plugins/service.md) · [events](docs/plugins/events.md) · [capability design](docs/plugins/capability-design.md) · [LLM adapters](docs/plugins/llm-adapter.md) · [publishing](docs/plugins/publish.md)
- Cookbooks: [add a tool](docs/cookbook/adding-a-tool.md) · [add a package](docs/cookbook/adding-a-package.md) · [add a settings card](docs/cookbook/adding-a-settings-card.md) · [add a conversation node](docs/cookbook/adding-a-conversation-node.md) · [add a vendored package](docs/cookbook/adding-a-vendored-package.md) · [extensions](docs/cookbook/extension-cookbook.md)
- [Post-mortems](docs/postmortem/README.md): bugs that got through, and the guardrails added afterwards

## Use it responsibly

<img src="docs/images/welcome.png" alt="Welcome to Fathom dialog: test only targets you own or are explicitly authorized to assess" width="420" align="right" />

Fathom is for systems you own or are explicitly authorized to test: your own applications, contracted engagements, bug bounty programs within their published scope, labs and CTFs. Authorization and scope are your responsibility; the scope gate is a safety net, not permission. Read each program's rules before testing, respect rate limits, and do not access other people's data beyond what is needed to prove an issue.

<br clear="right" />

## License

[MIT](LICENSE). Fathom builds on an MIT-licensed upstream project whose copyright notice is kept in the license. The bug-class skills keep their upstream CC BY 4.0 license ([attribution](packages/pentest/bounty-skills/ATTRIBUTION.md)). Third-party software is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
