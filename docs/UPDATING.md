# Installing and updating Pentest Harness

Pentest Harness runs as a local server with a web UI at `http://127.0.0.1:2323`. On Windows you can also use the **desktop app**: a small native window around the same web UI that starts the harness for you (no terminal), lives in the tray, and notifies you when a session needs your input. Both use the same data, so you can switch between them at any time.

Everything you own lives outside the code checkout, in `~/.dsh` (`$DSH_HOME`): `settings.yaml`, `.credentials.yaml` (your keys), `sessions/`, `profiles/`, and the pentest tools under `tools/`. Installing, updating or adding the app never touches it.

Pick your situation:

| You are… | Go to |
| --- | --- |
| Installing for the first time, browser only | [A. First install — web](#a-first-install--web) |
| Installing for the first time, with the desktop app | [B. First install — web + desktop app](#b-first-install--web--desktop-app) |
| Already on the web version, updating it | [C. Update the web version](#c-update-the-web-version) |
| Already on the web version, adding the desktop app | [D. Add the desktop app to a web install](#d-add-the-desktop-app-to-a-web-install) |
| Already using the desktop app, updating | [E. Update the desktop app install](#e-update-the-desktop-app-install) |

## Requirements

- **Everyone:** Git, **Node.js 20+** (22 recommended) and **pnpm** (`npm i -g pnpm`).
- **Desktop app (Windows only):** Windows 10 1809+ with the Edge WebView2 Runtime (built into Windows 11) and the [.NET SDK](https://dotnet.microsoft.com/download), version 10 or newer. Node.js must be on `PATH`, because the app starts the harness with it.

### Before running any desktop-app command

1. **Use PowerShell, not Command Prompt.** The app commands use `$env:LOCALAPPDATA` and `Start-Process`, which only exist in PowerShell. Open **Start → PowerShell**, or type `powershell` in an existing Command Prompt window, then `cd` into your checkout.
2. **Check the app's folder exists:** `Test-Path apps\desktop` must print `True`. The desktop app lives in [Pro-Nil/pentest-harness](https://github.com/Pro-Nil/pentest-harness); a clone of the original upstream repository does not have it. If it prints `False`, point your clone at this repository and update:

   ```powershell
   git remote set-url origin https://github.com/Pro-Nil/pentest-harness.git
   git pull origin main
   pnpm install
   pnpm build
   ```

## A. First install — web

```sh
git clone https://github.com/Pro-Nil/pentest-harness.git
cd pentest-harness
pnpm install
pnpm build
pnpm dsh web
```

The web UI opens at `http://127.0.0.1:2323`. Then add a model under **Settings → Models** (see the [README](../README.md#first-run--connect-any-ai-model)). Keep the terminal open while you work; `Ctrl+C` stops the harness.

## B. First install — web + desktop app

Run the first four commands of [A](#a-first-install--web) (clone, `cd`, `pnpm install`, `pnpm build`) but **not** `pnpm dsh web`: the app starts the harness itself. First do the two checks in [Before running any desktop-app command](#before-running-any-desktop-app-command). Then, in PowerShell from the checkout:

```powershell
dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

The window opens on the web UI. Closing it hides it to the tray; **tray icon → Quit** stops the app and the harness. To open it from the Start menu later, pin it while it runs or create a shortcut to `%LOCALAPPDATA%\Programs\PentestHarness\PentestHarness.exe`. Then add a model under **Settings → Models**.

## C. Update the web version

1. Stop the harness (`Ctrl+C` in its terminal).
2. Update and rebuild, from the checkout:

   ```sh
   git pull
   pnpm install
   pnpm build
   ```

3. Read the [upgrade notes](#upgrade-notes) below for anything you must change in `~/.dsh` first.
4. Start it again: `pnpm dsh web`.

Run all three update commands every time. A plugin that a mode uses but that was not built makes every session of that mode fail to start. If you have local changes, commit or stash them before `git pull`.

## D. Add the desktop app to a web install

1. Do [C](#c-update-the-web-version) steps 1–3 to get the latest code built, but don't start the harness from the terminal.
2. Do the two checks in [Before running any desktop-app command](#before-running-any-desktop-app-command), then install and open the app, in PowerShell from the checkout:

   ```powershell
   dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
   Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
   ```

Your existing sessions, models and keys show up in the app unchanged; it is the same harness. From now on start Pentest Harness from the app instead of `pnpm dsh web`, and update with [E](#e-update-the-desktop-app-install). You can still open `http://127.0.0.1:2323` in a browser while the app runs.

## E. Update the desktop app install

1. **Tray icon → Quit** (stops the app and the harness it started).
2. Update and rebuild the harness, from the checkout:

   ```sh
   git pull
   pnpm install
   pnpm build
   ```

3. Read the [upgrade notes](#upgrade-notes) below.
4. If the update changed the app itself (files under `apps/desktop` in the `git pull` output), reinstall it over the old one, in PowerShell:

   ```powershell
   dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
   ```

5. Open **Pentest Harness** again; it starts the updated harness.

**Updating only the app while the harness keeps running** (for example mid-engagement): publish to a staging folder, close the app without stopping the harness, swap the files and reopen. The reopened app re-attaches to the running harness.

```powershell
dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\PentestHarness\staged"
& "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe" --quit --keep-harness
Copy-Item "$env:LOCALAPPDATA\PentestHarness\staged\*" "$env:LOCALAPPDATA\Programs\PentestHarness" -Recurse -Force
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

Plain `--quit` (or tray → Quit) stops the harness too.

**Client-only changes** (styles, UI) need just `pnpm build` and a page reload (`Ctrl+R` in the app or browser), no restart.

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
| `MSB1009: Project file does not exist. Switch: apps/desktop` | Your checkout has no desktop app: it is a clone of the upstream repository, or you are not in the checkout folder. See [Before running any desktop-app command](#before-running-any-desktop-app-command). |
| `'Start-Process' is not recognized…` or a folder literally named `$env:LOCALAPPDATA` appears | The command ran in Command Prompt. Run it in PowerShell. |
| The app does not start and asks for a .NET runtime | Install the [.NET Desktop Runtime](https://dotnet.microsoft.com/download) 10 or newer, then reinstall the app with the publish command from [B](#b-first-install--web--desktop-app). |
| Port 2323 is already in use | Another harness is still running. Quit it (tray → Quit) or start on another port with `pnpm dsh web --port 3000`. |
