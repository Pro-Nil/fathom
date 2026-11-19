# Installing and updating Pentest Harness

Pentest Harness runs as a local server with a web UI at `http://127.0.0.1:2323`. On Windows and Linux you can also use the **desktop app**: a small native window around the same web UI that starts the harness for you (no terminal), lives in the tray, and notifies you when a session needs your input. Both use the same data, so you can switch between them at any time.

Everything you own lives outside the code checkout, in `~/.dsh` (`$DSH_HOME`): `settings.yaml`, `.credentials.yaml` (your keys), `sessions/`, `profiles/`, and the pentest tools under `tools/`. Installing, updating or adding the app never touches it.

Pick your situation:

| You are… | Go to |
| --- | --- |
| Installing for the first time, browser only | [A. First install — web](#a-first-install--web) |
| Installing for the first time, with the desktop app | [B. First install — web + desktop app](#b-first-install--web--desktop-app) |
| Already on the web version, updating it | [C. Update the web version](#c-update-the-web-version) |
| Already on the web version, adding the desktop app | [D. Add the desktop app to a web install](#d-add-the-desktop-app-to-a-web-install) |
| Already using the desktop app, updating | [E. Update the desktop app install](#e-update-the-desktop-app-install) |

On Linux, do [Linux setup](#linux-setup) first; every section below gives the Linux commands next to the Windows ones.

## Requirements

- **Everyone:** Git, **Node.js 20+** (22 recommended) and **pnpm** (`npm i -g pnpm`).
- **Linux, web version:** any x86-64 Linux with the requirements above. The first time the agent uses the browser, the harness downloads its Chromium build; if Chromium then reports missing system libraries, run `sudo npx playwright install-deps chromium` once from the checkout. Pentest tools install natively (apt plus release binaries; see the upgrade notes). Step-by-step package commands are in [Linux setup](#linux-setup).
- **Desktop app on Windows:** Windows 10 1809+ with the Edge WebView2 Runtime (built into Windows 11) and the [.NET SDK](https://dotnet.microsoft.com/download), version 10 or newer. Node.js must be on `PATH`, because the app starts the harness with it.
- **Desktop app on Linux:** an X11 desktop or a Wayland desktop with XWayland (GNOME, KDE Plasma and most others), the .NET 10 SDK, Node.js, the WebKitGTK 4.1 runtime and the X session libraries. See [Linux setup](#linux-setup).

## Linux setup

Do this once before [A](#a-first-install--web) or [B](#b-first-install--web--desktop-app). Every command runs in a normal terminal; only the package installs need `sudo`.

### 1. Git, Node.js and pnpm

Use Node.js 22 from **nvm**: distribution packages are often too old (Ubuntu 24.04 ships Node 18), and the desktop app finds nvm's Node by itself even when launched from the application menu.

```sh
sudo apt install git curl          # Fedora: sudo dnf install git curl   Arch: sudo pacman -S git curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# close and reopen the terminal so nvm is on PATH, then:
nvm install 22
npm i -g pnpm
node -v && pnpm -v
```

### 2. Desktop app only: .NET 10 SDK and the window libraries

Skip this step if you only use the browser.

**Debian / Ubuntu:**

```sh
sudo apt install dotnet-sdk-10.0
sudo apt install libwebkit2gtk-4.1-0 libice6 libsm6 fontconfig libnotify-bin
```

On Ubuntu 24.04, if `dotnet-sdk-10.0` is not found, add the .NET backports archive first: `sudo add-apt-repository ppa:dotnet/backports && sudo apt update`. On Debian, add Microsoft's package repository first ([instructions](https://learn.microsoft.com/dotnet/core/install/linux-debian)).

**Fedora:**

```sh
sudo dnf install dotnet-sdk-10.0 webkit2gtk4.1 libICE libSM fontconfig libnotify
```

**Arch:**

```sh
sudo pacman -S dotnet-sdk webkit2gtk-4.1 libice libsm fontconfig libnotify
```

**Any other distribution:** install the SDK with Microsoft's script, then publish the app **self-contained** (replace `--self-contained false` with `--self-contained true` in the publish commands below). A self-contained app carries its own .NET runtime, so it still starts from the application menu, where the `PATH` and `DOTNET_ROOT` from your shell profile are not set. Install the WebKitGTK 4.1, libICE, libSM, fontconfig and libnotify packages with your package manager.

```sh
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0
echo 'export DOTNET_ROOT="$HOME/.dotnet"; export PATH="$PATH:$HOME/.dotnet"' >> ~/.bashrc
```

Check with `dotnet --list-sdks`: it must list a `10.x` SDK.

Optional extras:

- **Tray icon on GNOME:** GNOME has no system tray by default. Install the AppIndicator extension (`sudo apt install gnome-shell-extension-appindicator`; Ubuntu usually has it on already) and log out and back in. Without a tray, closing the window still hides the app; launch it again from the menu to bring it back, and use the window's ⋯ menu → Quit to stop it.
- **Notification chime:** played through `pw-play`, `paplay` or `aplay`, whichever exists. Desktops with PipeWire or PulseAudio already have one.

### 3. Browser libraries for the agent

From the checkout, after `pnpm install` (in [A](#a-first-install--web) or [B](#b-first-install--web--desktop-app)):

```sh
sudo npx playwright install-deps chromium
```

This installs the system libraries the harness's Chromium needs. You can skip it and run it only if the agent's browser later fails to start with a missing `.so` library.

### Running inside WSL

On Windows 11, WSL Ubuntu with WSLg can run the Linux build of the app: do the Debian / Ubuntu steps inside WSL, keep the checkout in the WSL file system (`~/pentest-harness`, not `/mnt/c/…`), and follow the Linux commands below. Running the Windows build is simpler, though.

## Before running any desktop-app command

**Linux:** run the commands from the checkout in a normal terminal, and check that the app's folder exists: `test -d apps/desktop && echo yes` must print `yes`. If it prints nothing, see step 2 of the Windows list.

**Windows:**

1. **Use PowerShell, not Command Prompt.** The app commands use `$env:LOCALAPPDATA` and `Start-Process`, which only exist in PowerShell. Open **Start → PowerShell**, or type `powershell` in an existing Command Prompt window, then `cd` into your checkout.
2. **Check the app's folder exists:** `Test-Path apps\desktop` must print `True`. The desktop app lives in [Pro-Nil/pentest-harness](https://github.com/Pro-Nil/pentest-harness); a clone of the original upstream repository does not have it. If it prints `False`, point your clone at this repository and update (the same commands work in a Linux terminal):

   ```powershell
   git remote set-url origin https://github.com/Pro-Nil/pentest-harness.git
   git pull origin main
   pnpm install
   pnpm build
   ```

### Where things live

| | Windows | Linux |
| --- | --- | --- |
| Your data (sessions, keys, settings, tools) | `%USERPROFILE%\.dsh` | `~/.dsh` |
| Installed app | `%LOCALAPPDATA%\Programs\PentestHarness` | `~/.local/share/pentest-harness-app` |
| App settings (`settings.json`) and logs | `%LOCALAPPDATA%\PentestHarness` | `~/.local/share/PentestHarness` |
| Harness log (when the app started it) | `%LOCALAPPDATA%\PentestHarness\logs\harness.log` | `~/.local/share/PentestHarness/logs/harness.log` |
| App log | `%LOCALAPPDATA%\PentestHarness\logs\desktop.log` | `~/.local/share/PentestHarness/logs/desktop.log` |
| Menu entry | pin it or make a shortcut | `~/.local/share/applications/pentest-harness.desktop` (written on first launch) |

The app looks for the checkout at `~/pentest-harness` (`%USERPROFILE%\pentest-harness` on Windows). If yours is elsewhere, set `"repo"` in the app's `settings.json`, for example `"repo": "/home/you/code/pentest-harness"`. The file is written on first launch; quit the app before editing it.

## A. First install — web

Linux: do [Linux setup](#linux-setup) step 1 first (and step 3 after `pnpm install`).

```sh
git clone https://github.com/Pro-Nil/pentest-harness.git
cd pentest-harness
pnpm install
pnpm build
pnpm dsh web
```

The web UI opens at `http://127.0.0.1:2323` (on Linux and Windows alike). Then add a model under **Settings → Models** (see the [README](../README.md#first-run--connect-any-ai-model)). Keep the terminal open while you work; `Ctrl+C` stops the harness.

## B. First install — web + desktop app

Run the first four commands of [A](#a-first-install--web) (clone, `cd`, `pnpm install`, `pnpm build`) but **not** `pnpm dsh web`: the app starts the harness itself. Clone from your home folder so the checkout is `~/pentest-harness` and the app finds it without configuration. Then do the checks in [Before running any desktop-app command](#before-running-any-desktop-app-command).

**Windows** (PowerShell, from the checkout):

```powershell
dotnet publish apps/desktop -f net10.0-windows10.0.19041.0 -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

To open it from the Start menu later, pin it while it runs or create a shortcut to `%LOCALAPPDATA%\Programs\PentestHarness\PentestHarness.exe`.

**Linux** (terminal, from the checkout; do [Linux setup](#linux-setup) step 2 first):

```sh
dotnet publish apps/desktop -f net10.0 -c Release -r linux-x64 --self-contained false -o ~/.local/share/pentest-harness-app
setsid -f ~/.local/share/pentest-harness-app/PentestHarness
```

`setsid -f` detaches the app from the terminal, so closing the terminal does not close it. The first launch adds **Pentest Harness** to your application menu; open it from there from now on. On an ARM64 machine use `-r linux-arm64`.

On both systems the window opens on the web UI. Closing it hides it to the tray; **tray icon → Quit** (or the window's ⋯ menu → Quit) stops the app and the harness. **Start with Windows** / **Start at login** in the tray menu starts it hidden when you log in. Then add a model under **Settings → Models**.

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

If `git pull` stops with **"Your local changes to the following files would be overwritten by merge"** (usually `pnpm-lock.yaml` or a `package.json` that an older `pnpm install` rewrote), nothing was updated. Set those changes aside and pull again:

```sh
git stash
git pull
```

Then continue with `pnpm install` and `pnpm build`. Run `git stash drop` later if you don't need the stashed edits.

Run all three update commands every time. A plugin that a mode uses but that was not built makes every session of that mode fail to start. If you have local changes, commit or stash them before `git pull`.

## D. Add the desktop app to a web install

1. Do [C](#c-update-the-web-version) steps 1–3 to get the latest code built, but don't start the harness from the terminal.
2. Do the checks in [Before running any desktop-app command](#before-running-any-desktop-app-command) (on Linux, also [Linux setup](#linux-setup) step 2), then install and open the app from the checkout.

   **Windows** (PowerShell):

   ```powershell
   dotnet publish apps/desktop -f net10.0-windows10.0.19041.0 -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
   Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
   ```

   **Linux:**

   ```sh
   dotnet publish apps/desktop -f net10.0 -c Release -r linux-x64 --self-contained false -o ~/.local/share/pentest-harness-app
   setsid -f ~/.local/share/pentest-harness-app/PentestHarness
   ```

   If your checkout is not `~/pentest-harness`, the app says it can't find the harness: set `"repo"` in its `settings.json` (see [Where things live](#where-things-live)) and open it again.

Your existing sessions, models and keys show up in the app unchanged; it is the same harness. From now on start Pentest Harness from the app instead of `pnpm dsh web`, and update with [E](#e-update-the-desktop-app-install). You can still open `http://127.0.0.1:2323` in a browser while the app runs.

## E. Update the desktop app install

1. **Tray icon → Quit** (or ⋯ menu → Quit; stops the app and the harness it started).
2. Update and rebuild the harness, from the checkout:

   ```sh
   git pull
   pnpm install
   pnpm build
   ```

3. Read the [upgrade notes](#upgrade-notes) below.
4. If the update changed the app itself (files under `apps/desktop` in the `git pull` output), reinstall it over the old one.

   **Windows** (PowerShell):

   ```powershell
   dotnet publish apps/desktop -f net10.0-windows10.0.19041.0 -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
   ```

   **Linux:**

   ```sh
   dotnet publish apps/desktop -f net10.0 -c Release -r linux-x64 --self-contained false -o ~/.local/share/pentest-harness-app
   ```

5. Open **Pentest Harness** again (Start menu or application menu); it starts the updated harness.

**Updating only the app while the harness keeps running** (for example mid-engagement): publish to a staging folder, close the app without stopping the harness, swap the files and reopen. The reopened app re-attaches to the running harness.

Windows (PowerShell):

```powershell
dotnet publish apps/desktop -f net10.0-windows10.0.19041.0 -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\PentestHarness\staged"
& "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe" --quit --keep-harness
Copy-Item "$env:LOCALAPPDATA\PentestHarness\staged\*" "$env:LOCALAPPDATA\Programs\PentestHarness" -Recurse -Force
Start-Process "$env:LOCALAPPDATA\Programs\PentestHarness\PentestHarness.exe"
```

Linux:

```sh
dotnet publish apps/desktop -f net10.0 -c Release -r linux-x64 --self-contained false -o ~/.local/share/PentestHarness/staged
~/.local/share/pentest-harness-app/PentestHarness --quit --keep-harness
cp -r ~/.local/share/PentestHarness/staged/. ~/.local/share/pentest-harness-app/
setsid -f ~/.local/share/pentest-harness-app/PentestHarness
```

Plain `--quit` (or tray → Quit) stops the harness too.

**Client-only changes** (styles, UI) need just `pnpm build` and a page reload (`Ctrl+R` in the app or browser), no restart.

### Removing the app

Quit it first. On Windows, delete `%LOCALAPPDATA%\Programs\PentestHarness` (and `%LOCALAPPDATA%\PentestHarness` for its settings and logs). On Linux:

```sh
rm -rf ~/.local/share/pentest-harness-app ~/.local/share/PentestHarness
rm -f ~/.local/share/applications/pentest-harness.desktop ~/.config/autostart/pentest-harness.desktop ~/.local/share/icons/hicolor/256x256/apps/pentest-harness.png
```

Your sessions and keys in `~/.dsh` stay, and `pnpm dsh web` still works.

## Upgrade notes

### Desktop app rebuilt on Avalonia (Windows and Linux)

The desktop app now runs on Windows and Linux. On Windows it draws a single title bar of its own (session title, status and window buttons); on Linux the window manager's title bar stays and the status strip sits under it. The Windows publish command gains `-f net10.0-windows10.0.19041.0`; Linux uses `-f net10.0 -r linux-x64` (see [B](#b-first-install--web--desktop-app)). To move an existing install: **tray icon → Quit** the old app first (its `--quit` signal is not understood by the new one, and the reverse), then run the new publish command from [E](#e-update-the-desktop-app-install) step 4 and reopen. Settings, logs and the in-app browser profile in `%LOCALAPPDATA%\PentestHarness` carry over.

### DeepSeek removed

The built-in DeepSeek model adapter and DeepSeek web search are gone. Models come only from the providers you add under **Settings → Models** (any OpenAI-compatible endpoint, or a catalog provider such as OpenAI or Anthropic).

If you had DeepSeek configured, clean up before restarting:

1. In `~/.dsh/profiles/<profile>/cordis.patch.yml`, delete any `- id: llm-deepseek` or `- id: web-search-deepseek` entry. A patch entry whose plugin no longer exists stops the harness from starting.
2. In `~/.dsh/settings.yaml`, delete the `llm-deepseek:` and `web-search-deepseek:` sections if present.
3. If `agent-default-model` still names `deepseek-official`, pick a model in the composer's model picker (it saves the new default).
4. A stored `DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml` is unused; remove it if you like.

The Python SDK now defaults to `provider="openai-compatible"` and reads `LLM_BASE_URL` and `LLM_API_KEY` (previously `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`).

### Web search engine

Web search defaults to Google, through a hidden page of the harness browser (no key). If Google blocks the search with a CAPTCHA, the harness falls back to the next engine: Google API, DuckDuckGo, Exa, Perplexity. Pick the engine and turn the fallback on or off under **Settings → Plugins → Web search**. The Google API engine needs `GOOGLE_API_KEY` and `GOOGLE_CSE_ID` stored as credentials (Programmable Search, 100 free queries a day).

### English-only interface

The interface, docs and tooling are English only. A language preference saved by an older build is ignored, so nothing in `~/.dsh` needs changing.

### Pentest tools install themselves

Pentest-mode sessions ask once how to install the toolkit and install it in the background: on Windows through WSL Ubuntu or natively, on Linux natively (apt packages plus verified release binaries in `~/.dsh/tools/bin`). On Linux, apt runs only when the harness runs as root or `sudo` needs no password; otherwise the result names the single `sudo apt-get install …` command to run yourself. The choice is saved in `~/.dsh/tools/state.json`; delete that file to be asked again.

### Stopping background jobs

Stopping a turn does not stop background jobs. Use **Stop** on the job in the session header's background-jobs list.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Every session of a preset fails with `preset … failed to mount … Cannot find module` | A new plugin was not built. Run `pnpm build` (or `npm run build:lib:host`) and restart. |
| Harness exits at start after an update | Look for a patch entry naming a removed plugin in `~/.dsh/profiles/*/cordis.patch.yml` (see the upgrade notes). The desktop app's log is `%LOCALAPPDATA%\PentestHarness\logs\harness.log` (Linux: `~/.local/share/PentestHarness/logs/harness.log`). |
| The model picker is empty or the page keeps reloading | The harness is failing to start sessions; check the log above, fix, restart, then reload the page. |
| `pnpm install` fails in `postinstall` with an "invalid ownership marker" | The git-hooks folder was installed by an older build. Delete `.git/dsh-hooks` and run `pnpm install` again. |
| `MSB1009: Project file does not exist. Switch: apps/desktop` | Your checkout has no desktop app: it is a clone of the upstream repository, or you are not in the checkout folder. See [Before running any desktop-app command](#before-running-any-desktop-app-command). |
| `'Start-Process' is not recognized…` or a folder literally named `$env:LOCALAPPDATA` appears | The command ran in Command Prompt. Run it in PowerShell. |
| The app does not start and asks for a .NET runtime | Install the [.NET Desktop Runtime](https://dotnet.microsoft.com/download) 10 or newer, then reinstall the app with the publish command from [B](#b-first-install--web--desktop-app). |
| `git pull` says local changes "would be overwritten by merge" | The pull did nothing, so later steps rebuild the old version. Run `git stash`, then `git pull` again (see [C](#c-update-the-web-version)). |
| Linux: the app says it could not find the harness | Your checkout is not `~/pentest-harness`. Set `"repo"` in `~/.local/share/PentestHarness/settings.json` to the checkout's full path and open the app again. |
| Linux: "Node.js was not found on PATH" | The app was opened from the menu without your shell's `PATH`. Run `which node` in a terminal and put that full path in `"node"` in `settings.json`. |
| Linux: "You must install .NET to run this application" when opened from the menu | .NET was installed with `dotnet-install.sh` into `~/.dotnet`, which menu launches can't see. Republish with `--self-contained true`, or tell the system where it is: `echo $HOME/.dotnet \| sudo tee /etc/dotnet/install_location`. |
| Linux: the app exits at start, or the window stays blank | A window library is missing or there is no graphical session. Read `~/.local/share/PentestHarness/logs/desktop.log`, install the packages from [Linux setup](#linux-setup) step 2, and check that `echo $DISPLAY` prints something. |
| Linux: no tray icon | GNOME needs the AppIndicator extension (see [Linux setup](#linux-setup)). Until then, quit from the window's ⋯ menu. |
| Linux: no desktop notifications | Install `libnotify-bin` (Fedora and Arch: `libnotify`) so `notify-send` exists. |
| Linux: the agent's browser fails with a missing `.so` library | Run `sudo npx playwright install-deps chromium` from the checkout. |
| Port 2323 is already in use | Another harness is still running. Quit it (tray → Quit) or start on another port with `pnpm dsh web --port 3000`. |
