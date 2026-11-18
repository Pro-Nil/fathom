# Updating Pentest Harness

How to move an existing install to the latest code without losing your sessions, settings or keys. Everything you own lives outside the checkout, in `~/.dsh` (`$DSH_HOME`): `settings.yaml`, `.credentials.yaml`, `sessions/`, `profiles/` and the installed pentest tools under `tools/`. Updating the checkout never touches it.

## 1. Update the code

From your clone:

```sh
git pull
pnpm install
pnpm build
```

`pnpm build` rebuilds the host libraries and the web client. Run all three every time: a plugin that is referenced by a preset but not built makes every session of that preset fail to start (see [Troubleshooting](#troubleshooting)).

If you have local changes, commit or stash them before `git pull`.

## 2. Restart the harness

A running harness keeps the code it started with, so restart it after building.

- **Terminal:** stop `pnpm dsh web` with `Ctrl+C`, then start it again.
- **Windows desktop app:** right-click the tray icon → **Quit**, then open **Pentest Harness** from the Start menu. Quit stops the harness the app started; reopening starts it with the new build.

Client-only changes (styles, UI) need just `pnpm build` and a browser reload; anything under `packages/*/src` that runs on the host needs the restart.

## 3. Desktop app (Windows, optional)

**Web-only users can stop here.** The desktop app is just a window around the same web UI; nothing in steps 1–2 depends on it, and you can keep using the browser at `http://127.0.0.1:2323`.

### Install it for the first time

Needs Windows 10 1809+ with the Edge WebView2 Runtime (built into Windows 11), the [.NET 10 SDK](https://dotnet.microsoft.com/download), and Node.js on `PATH`. First stop any harness you started from a terminal (`Ctrl+C`), so the app can start its own:

```powershell
dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

The app starts the harness itself (no terminal), hides to the tray when closed, and notifies you when a session needs your input. To find it again from the Start menu, pin the running app or create a shortcut to `PentestHarness.exe`. Your sessions, settings and keys are the same ones the web version used.

### Update it

Only needed when `apps/desktop` changed. Publish to a staging folder, close the app without stopping the harness, swap the files, and reopen:

```powershell
dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\PentestHarness\staged"
& "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe" --quit --keep-harness
Copy-Item "$env:LOCALAPPDATA\PentestHarness\staged\*" "$env:LOCALAPPDATA\Programs\PentestHarness" -Recurse -Force
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

`--keep-harness` leaves the running harness alone and the reopened app re-attaches to it. Plain `--quit` stops the harness too.

## Upgrade notes

### DeepSeek removed

The built-in DeepSeek model adapter and DeepSeek web search are gone. Models come only from the providers you add under **Settings → Models** (any OpenAI-compatible endpoint, or a catalog provider such as OpenAI or Anthropic). Web search uses DuckDuckGo and needs no key.

If you had DeepSeek configured, clean up before restarting:

1. In `~/.dsh/profiles/<profile>/cordis.patch.yml`, delete any `- id: llm-deepseek` or `- id: web-search-deepseek` entry. A patch entry whose plugin no longer exists stops the harness from starting.
2. In `~/.dsh/settings.yaml`, delete the `llm-deepseek:` and `web-search-deepseek:` sections if present.
3. If `agent-default-model` still names `deepseek-official`, pick a model in the composer's model picker (it saves the new default).
4. A stored `DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml` is unused; remove it if you like.

The Python SDK now defaults to `provider="openai-compatible"` and reads `LLM_BASE_URL` and `LLM_API_KEY` (previously `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`).

### Pentest tools install themselves

Pentest-mode sessions ask once how to install the toolkit (WSL Ubuntu, Windows native, or not now) and install it in the background. The choice is saved in `~/.dsh/tools/state.json`; delete that file to be asked again.

### Stopping background jobs

Stopping a turn does not stop background jobs. Use **Stop** on the job in the session header's background-jobs list.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Every session of a preset fails with `preset … failed to mount … Cannot find module` | A new plugin was not built. Run `pnpm build` (or `npm run build:lib:host`) and restart. |
| Harness exits at start after an update | Look for a patch entry naming a removed plugin in `~/.dsh/profiles/*/cordis.patch.yml` (see the upgrade notes). The desktop app's log is `%LOCALAPPDATA%\PentestHarness\logs\harness.log`. |
| The model picker is empty or the page keeps reloading | The harness is failing to start sessions; check the log above, fix, restart, then reload the page. |
| `pnpm install` fails in `postinstall` with an "invalid ownership marker" | The git-hooks folder was installed by an older build. Delete `.git/dsh-hooks` and run `pnpm install` again. |
| Port 2323 is already in use | Another harness is still running. Quit it (tray → Quit) or start on another port with `pnpm dsh web --port 3000`. |
