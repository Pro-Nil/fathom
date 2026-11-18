# Pentest Harness desktop app (Windows)

A small native window around the harness web UI: WinForms + Edge WebView2 on .NET 10, about 26 MB installed (no bundled Chromium).

- **Opening the app runs the harness.** It starts `node --import tsx/esm apps/cli/src/bin.ts web --no-open` in the checkout with no console window and shows the UI when the server answers. If something already listens on the port (for example a server started from a terminal), the app attaches to it instead.
- **The X hides to the tray.** The harness keeps working. Click the tray icon to bring the window back.
- **Quit (tray menu) really closes it.** The server the app started runs inside a Windows Job Object, so Quit, or the app crashing, ends node and every process it spawned. A server the app only attached to is left running. *Restart harness* offers to replace it with one the app owns.
- **Notifications when a session needs you.** When the agent asks a question, wants a tool approval or has a plan to review, the app plays its own chime and shows a Windows toast with a short summary. Clicking the toast opens the window. While the window is focused it only plays the chime; set `notifyWhenFocused` to also show the toast. If Windows *Do not disturb* is on, Windows keeps the toast in the notification centre without a banner.

- **Its own title bar.** The window is frameless. A 38 px bar drawn into the page replaces the Windows caption. It shows the current session, a waiting-for-you count, the server state (Running / Attached / Starting / Stopped with the port), reload, open in browser, a ⋯ menu with the tray actions, and the window controls. Its empty space is a native drag region, so dragging, double-click to maximize, snapping and resizing work as usual. Note: when the app started the harness, quitting or restarting the app also restarts the harness.

Tray menu: Open, Restart harness, Open log, Open in browser, Send test notification, Start with Windows, Quit.

## Build and install

```powershell
dotnet publish apps/desktop -c Release -r win-x64 --self-contained false -o "$env:LOCALAPPDATA\Programs\PentestHarness"
```

Then create a Start menu shortcut to `PentestHarness.exe` (the first install did this, plus a Desktop shortcut). `python apps/desktop/tools/make_assets.py` regenerates the icon and the chime.

Requirements: Windows 10 1809+ with the Edge WebView2 Runtime (preinstalled on Windows 11), the .NET 10 Desktop Runtime, and Node.js on PATH.

## Files

| Path | Purpose |
| --- | --- |
| `%LOCALAPPDATA%\PentestHarness\settings.json` | `repo` (checkout path), `port`, `node`, `startupTimeoutSeconds`, `notifyWhenFocused`, window bounds |
| `%LOCALAPPDATA%\PentestHarness\logs\harness.log` | Output of the server the app started (rotated at 5 MB) |
| `%LOCALAPPDATA%\PentestHarness\logs\desktop.log` | The app's own events: server start, stop, detach, reconnect |
| `%LOCALAPPDATA%\PentestHarness\WebView2` | The embedded browser profile |

Command-line: `--tray` starts hidden (used by Start with Windows), `--test-notification` and `--quit` act on the running instance, `--quit --keep-harness` closes only the app (for updates; the next launch takes the harness back), and any other second launch brings the window forward.

## How input-needed is detected

`web/bridge.js` is injected into the UI before its scripts run. It wraps `WebSocket` and watches the UI's own event stream for `question/requested` and `approval/requested` frames, then posts a short summary to the native side. It never changes or answers anything, and the harness needs no change.
