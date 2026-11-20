# Fathom desktop app (Windows and Linux)

A small native window around the harness web UI, built with [Avalonia](https://avaloniaui.net) 12 on .NET 10. The page is shown by the system web view (Edge WebView2 on Windows, WebKitGTK or WPE WebKit on Linux), so no Chromium is bundled. On Linux, WebKitGTK renders offscreen and Avalonia draws its frames into the window (the WebView package marks this mode experimental).

- **Opening the app runs the harness.** It starts `node --import tsx/esm apps/cli/src/bin.ts web --no-open` in the checkout with no console window and shows the UI when the server answers. If something already listens on the port (for example a server started from a terminal), the app attaches to it instead.
- **Closing the window hides it to the tray.** The harness keeps working. Click the tray icon to bring the window back.
- **Quit (tray menu) really closes it.** On Windows the server the app started runs inside a Job Object, so Quit, or the app crashing, ends node and every process it spawned; on Linux Quit kills the process tree. A server the app only attached to is left running. *Restart harness* replaces it with one the app owns.
- **Notifications when a session needs you.** When the agent asks a question, wants a tool approval or has a plan to review, the app plays its own chime and shows a notification with a short summary: a Windows toast (clicking it opens the window), or a desktop notification through `notify-send` on Linux. While the window is focused it only plays the chime; set `notifyWhenFocused` to also show the notification.
- **One title bar.** On Windows the app draws its own title bar into the page (drag, double-click, snap and the window buttons work as usual); on Linux the window manager's title bar stays and the strip sits under it. The strip shows the current session, a waiting-for-you count, the server state (Running / Attached / Starting / Stopped with the port), reload, open in browser and a ⋯ menu with the tray actions.

- **Update from the app.** When the checkout's tracked branch has new commits, or the checkout has commits the running build was not made from, an Update button appears in the title bar. It pulls, runs `pnpm install` and `pnpm build` while the harness keeps running, restarts the harness, and reinstalls and reopens the app when `apps/desktop` changed. Output goes to `logs/update.log`. See [docs/UPDATING.md](../../docs/UPDATING.md#e-update-the-desktop-app-install).

Tray menu: Open, Update and restart (or Check for updates), Restart harness, Open log, Open update log, Open in browser, Send test notification, Start with Windows / Start at login, Quit.

## Build and install

Windows (PowerShell, from the checkout):

```powershell
dotnet publish apps/desktop -f net10.0-windows10.0.19041.0 -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\Fathom"
```

Linux (from the checkout; full package list and per-distribution commands in [docs/UPDATING.md](../../docs/UPDATING.md#linux-setup)):

```sh
dotnet publish apps/desktop -f net10.0 -c Release -r linux-x64 --self-contained false -o ~/.local/share/fathom-app
~/.local/share/fathom-app/Fathom
```

On Linux the first launch adds **Fathom** to the desktop's application menu (`~/.local/share/applications/fathom.desktop`).

`python apps/desktop/tools/make_assets.py` regenerates the icon and the chime.

Requirements:

- **Windows:** Windows 10 1809+ with the Edge WebView2 Runtime (preinstalled on Windows 11), the .NET 10 SDK (or the .NET Desktop Runtime 10+ to only run a build), and Node.js on PATH.
- **Linux:** an X11 or XWayland desktop session, the .NET 10 SDK (or runtime), Node.js, and the WebKitGTK runtime and the X session libraries Avalonia loads: `sudo apt install libwebkit2gtk-4.1-0 libice6 libsm6 fontconfig` on Debian/Ubuntu (`webkit2gtk4.1 libICE libSM` on Fedora). Notifications use `notify-send` (`libnotify-bin`); the chime plays through `pw-play`, `paplay` or `aplay`, whichever exists. The tray icon needs a desktop with a system tray (StatusNotifierItem); on GNOME that is the AppIndicator extension.

## Files

The app folder is `%LOCALAPPDATA%\Fathom` on Windows and `~/.local/share/Fathom` on Linux (`FATHOM_APP_DIR` overrides it, for a separate test instance).

| Path in the app folder | Purpose |
| --- | --- |
| `settings.json` | `repo` (checkout path), `port`, `node`, `startupTimeoutSeconds`, `notifyWhenFocused`, window bounds |
| `logs/harness.log` | Output of the server the app started (rotated at 5 MB) |
| `logs/desktop.log` | The app's own events: server start, stop, detach, reconnect, web view setup |
| `WebView2` (Windows) / `WebView` (Linux) | The embedded browser profile |

Command line: `--tray` starts hidden (used by start at login), `--test-notification` and `--quit` act on the running instance, `--quit --keep-harness` closes only the app (for updates; the next launch takes the harness back), and any other second launch brings the window forward. A second launch reaches the running app through a per-user named pipe (a Unix socket on Linux).

## How input-needed is detected

`web/bridge.js` runs in the UI before its own scripts: the app registers it at document start through the native web view (WebView2's `AddScriptToExecuteOnDocumentCreated` on Windows, a WebKit user script on Linux). It wraps `WebSocket` and watches the UI's own event stream for `question/requested` and `approval/requested` frames, then posts a short summary to the app through `invokeCSharpAction`. It never changes or answers anything, and the harness needs no change. If document-start injection is unavailable the app injects the bridge after each load; the status bar then works at once and notifications start from the next reload.
