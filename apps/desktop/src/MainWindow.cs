using System.Diagnostics;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Threading;

namespace Fathom.Desktop;

/// <summary>
/// The app window: the harness web UI in the system web view. Closing it hides
/// it to the tray; only Quit (tray or menu) exits, which also stops the harness
/// the app started.
/// </summary>
internal sealed class MainWindow : Window
{
    private static readonly Color Dark = Color.FromRgb(11, 11, 13);

    private readonly AppSettings settings;
    private readonly HarnessServer server;
    private readonly Updater updater;
    /// <summary>The last update check, shown as the bar's Update button.</summary>
    private Updater.Status? updateStatus;
    /// <summary>The running update's current step; null when none runs.</summary>
    private string? updateStep;
    private bool updateLoopStarted;
    private readonly NativeWebView web;
    private readonly Border menuAnchor;
    private readonly CancellationTokenSource lifetime = new();
    private readonly string bridge = Embedded.Text("bridge.js");
    private bool quitting;
    private bool uiLoaded;
    private bool injectedAtStart;
    private int waiting;
    private string serverState = "starting";
    private DateTime lastChime = DateTime.MinValue;

    /// <summary>The tray tooltip changed (waiting count, attached server).</summary>
    public event Action<string>? TipChanged;

    /// <summary>The app is quitting; the tray removes itself.</summary>
    public event Action? Quitting;

    public MainWindow(AppSettings settings)
    {
        this.settings = settings;
        server = new HarnessServer(settings);
        server.Exited += code => Dispatcher.UIThread.Post(() => OnServerExited(code));
        updater = new Updater(settings);

        Title = "Fathom";
        Icon = new WindowIcon(Embedded.Open("app.png"));
        Background = new SolidColorBrush(Dark);
        MinWidth = 720;
        MinHeight = 480;
        RequestedThemeVariant = ThemeVariant.Dark;
        RestoreBounds_();

        web = new NativeWebView { Background = new SolidColorBrush(Dark) };
        web.EnvironmentRequested += OnEnvironmentRequested;
        web.AdapterCreated += (_, args) =>
        {
            injectedAtStart = Platform.InjectAtDocumentStart(args.TryGetPlatformHandle(), bridge, HarnessServer.AppLog);
            HarnessServer.AppLog($"web view ready ({web.AdapterInfo}); bridge at document start: {injectedAtStart}");
        };
        web.WebMessageReceived += (_, args) => OnWebMessage(args.Body);
        web.NavigationStarted += OnNavigationStarted;
        web.NavigationCompleted += OnNavigationCompleted;
        web.NewWindowRequested += (_, args) =>
        {
            // Links that open a new window go to the default browser.
            args.Handled = true;
            if (args.Request is { } uri) Platform.OpenExternal(uri.ToString());
        };

        // An invisible anchor at the top right positions the app menu under
        // the bar's ⋯ button (left of the window buttons when the bar is the title bar).
        menuAnchor = new Border { Width = 1, Height = 34, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 0, CustomFrame ? 156 : 12, 0) };
        Content = new Grid { Children = { web, menuAnchor } };
        UpdateResizeStrip();
#if WINDOWS
        // Remove the native caption now, while the window exists but is not
        // shown: attached in Opened, the first frames still had Windows' own
        // title bar above the page's.
        WindowFrame.Attach(this);
#endif

        Opened += async (_, _) => await StartAsync();
        Closing += OnClosing;
        PropertyChanged += (_, args) =>
        {
            if (args.Property != WindowStateProperty) return;
            UpdateResizeStrip();
            PushChrome();
        };
    }

    /// <summary>
    /// Windows: the page's bar is the title bar (WindowFrame removes the native
    /// caption). Linux keeps the desktop's title bar and the bar sits under it.
    /// </summary>
    private static bool CustomFrame => OperatingSystem.IsWindows();

    /// <summary>Leave a thin strip above the web view so the top edge stays resizable.</summary>
    private void UpdateResizeStrip()
    {
#if WINDOWS
        web.Margin = new Thickness(0, WindowState == WindowState.Normal ? WindowFrame.ResizeStrip : 0, 0, 0);
#endif
    }

    private void OnEnvironmentRequested(object? sender, WebViewEnvironmentRequestedEventArgs args)
    {
        args.EnableDevTools = true;
        // Windows keeps the WinForms app's profile folder, so in-app browser data carries over.
        var data = Path.Combine(AppSettings.Folder, OperatingSystem.IsWindows() ? "WebView2" : "WebView");
        switch (args)
        {
            case WindowsWebView2EnvironmentRequestedEventArgs webView2:
                webView2.UserDataFolder = data;
                break;
            case GtkWebViewEnvironmentRequestedEventArgs gtk:
                gtk.BaseDataDirectory = data;
                // WebKitGTK cannot be reparented into an Avalonia window; it
                // renders offscreen and Avalonia composites the frames instead.
                gtk.ExperimentalOffscreen = true;
                gtk.ApplicationNameForUserAgent = "Fathom";
                break;
            case LinuxWpeWebViewEnvironmentRequestedEventArgs wpe:
                wpe.DataDirectory = data;
                break;
        }
    }

    // ── startup ─────────────────────────────────────────────────────────

    private async Task StartAsync()
    {
        web.NavigateToString(Embedded.Text("splash.html"), new Uri("about:blank"));
        await Task.Delay(300);
        await ConnectAsync();
    }

    private async Task ConnectAsync()
    {
        uiLoaded = false;
        try
        {
            await server.StartAsync(text => SetSplash(text, false, ""), lifetime.Token);
            uiLoaded = true;
            serverState = server.Owned ? "running" : "attached";
            web.Navigate(server.Url);
            TipChanged?.Invoke(server.Owned ? "Fathom" : "Fathom (attached to a running server)");
            StartUpdateChecks();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            SetSplash(ex.Message, true, "Use the tray menu to retry or open the log.");
            if (!IsVisible) ShowFromTray();
        }
    }

    private void OnNavigationStarted(object? sender, WebViewNavigationStartingEventArgs args)
    {
        if (!uiLoaded || args.Request is not { } target || target.Scheme is "about" or "data") return;
        if (target.Host is "127.0.0.1" or "localhost" && target.Port == settings.Port) return;
        // Anything outside the harness opens in the default browser.
        args.Cancel = true;
        Platform.OpenExternal(target.ToString());
    }

    private async void OnNavigationCompleted(object? sender, WebViewNavigationCompletedEventArgs args)
    {
        if (!uiLoaded) return;
        // If document-start injection did not reach this page, the bridge
        // still adds the status bar and theme sync after load; its
        // notifications then start once it can wrap WebSocket in time.
        try
        {
            var present = await web.InvokeScript("String(!!window.__phBridge)");
            if (present?.Contains("true", StringComparison.Ordinal) != true)
            {
                if (!injectedAtStart) HarnessServer.AppLog("bridge injected after load (no document-start injection on this platform)");
                await web.InvokeScript(bridge);
            }
        }
        catch (Exception ex)
        {
            HarnessServer.AppLog($"bridge after load failed: {ex.Message}");
        }
        PushChrome();
    }

    private void OnServerExited(int code)
    {
        if (quitting) return;
        serverState = "stopped";
        PushChrome();
        Notify("Fathom stopped", $"The harness exited (code {code}). Use Restart harness in the tray menu.", "stopped", urgent: false);
        PlayChime();
    }

    // ── messages from the page ──────────────────────────────────────────

    private sealed record Notice(string? Kind, string? Title, string? Body, string? SessionId, bool? Dark = null, string? Background = null, string? Action = null);

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private void OnWebMessage(string? body)
    {
        if (string.IsNullOrEmpty(body)) return;
        Notice? notice;
        try { notice = JsonSerializer.Deserialize<Notice>(body, Json); }
        catch (JsonException) { return; }
        if (notice is null) return;
        Dispatcher.UIThread.Post(() =>
        {
            switch (notice.Kind)
            {
                case "theme": ApplyTheme(notice.Dark == true, notice.Background); break;
                case "window": HandleWindowAction(notice.Action, notice.Title); break;
                default: HandleNotice(notice, test: false); break;
            }
        });
    }

    private void HandleNotice(Notice notice, bool test)
    {
        if (notice.Kind == "resolved")
        {
            waiting = Math.Max(0, waiting - 1);
            TipChanged?.Invoke(waiting == 0 ? "Fathom" : $"Fathom — {waiting} waiting for you");
            PushChrome();
            return;
        }
        if (!test)
        {
            waiting++;
            TipChanged?.Invoke($"Fathom — {waiting} waiting for you");
            PushChrome();
        }
        PlayChime();
        var focused = IsVisible && WindowState != WindowState.Minimized && IsActive;
        if (test || !focused || settings.NotifyWhenFocused) Notify(notice.Title ?? "Fathom needs you", notice.Body ?? "", notice.Kind ?? "input", urgent: true);
        if (!focused) Platform.RequestAttention(this);
    }

    private void HandleWindowAction(string? action, string? title)
    {
        switch (action)
        {
            case "ready": PushChrome(); break;
            // Taskbar / Alt-Tab (and the Linux title bar) follow the page: "<session> — Fathom".
            case "title": Title = string.IsNullOrWhiteSpace(title) ? "Fathom" : title; break;
            case "minimize": WindowState = WindowState.Minimized; break;
            case "maximize": WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized; break;
            case "close": Close(); break;
            case "reload": if (uiLoaded) web.Refresh(); break;
            case "external": Platform.OpenExternal(server.Url.ToString()); break;
            // The page already asked the user to confirm.
            case "update": _ = UpdateAsync(); break;
            case "menu":
                var menu = BuildMenu();
                menu.PlacementTarget = menuAnchor;
                menu.Placement = PlacementMode.BottomEdgeAlignedRight;
                menu.Open(menuAnchor);
                break;
        }
    }

    /// <summary>Send the bar what it shows: server state, port, waiting count, window buttons.</summary>
    private void PushChrome()
    {
        if (!uiLoaded) return;
        var update = new
        {
            available = updateStatus?.Available == true,
            behind = updateStatus?.Behind ?? 0,
            unbuilt = updateStatus?.Unbuilt == true,
            upstream = updateStatus?.Upstream,
            problem = updateStatus?.Problem,
            step = updateStep,
        };
        var state = JsonSerializer.Serialize(new { type = "chrome", state = serverState, port = settings.Port, waiting, frame = CustomFrame, maximized = WindowState == WindowState.Maximized, update });
        _ = SafeScript($"window.__phChrome && window.__phChrome({state})");
    }

    private async Task SafeScript(string script)
    {
        try { await web.InvokeScript(script); }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or NotSupportedException) { }
    }

    private void Notify(string title, string body, string tag, bool urgent)
    {
        if (!Platform.Notify(title, body, tag, urgent)) TipChanged?.Invoke($"{title} — {body}");
    }

    private void PlayChime()
    {
        // Several parallel requests arrive together: one chime is enough.
        if ((DateTime.UtcNow - lastChime).TotalMilliseconds < 1500) return;
        lastChime = DateTime.UtcNow;
        Platform.PlayChime();
    }

    /// <summary>Match the window to the page palette.</summary>
    private void ApplyTheme(bool dark, string? background)
    {
        var color = ParseCssColor(background) ?? (dark ? Dark : Colors.White);
        Background = new SolidColorBrush(color);
        web.Background = new SolidColorBrush(color);
        RequestedThemeVariant = dark ? ThemeVariant.Dark : ThemeVariant.Light;
    }

    /// <summary>Parse <c>rgb(r, g, b)</c> / <c>rgba(...)</c> from getComputedStyle.</summary>
    private static Color? ParseCssColor(string? css)
    {
        if (css is null) return null;
        var match = System.Text.RegularExpressions.Regex.Match(css, @"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)");
        if (!match.Success) return null;
        if (match.Groups[4].Success && double.TryParse(match.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture, out var alpha) && alpha < 0.5) return null;
        return Color.FromRgb(byte.Parse(match.Groups[1].Value), byte.Parse(match.Groups[2].Value), byte.Parse(match.Groups[3].Value));
    }

    // ── window and menu ─────────────────────────────────────────────────

    private void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (quitting) return;
        // The X hides to the tray; the harness keeps running.
        e.Cancel = true;
        SaveBounds();
        Hide();
        if (!settings.TrayHintShown)
        {
            settings.TrayHintShown = true;
            settings.Save();
            Notify("Still running in the tray", "Fathom keeps working in the background. Use the tray icon's Quit to close it.", "tray", urgent: false);
        }
    }

    /// <summary>The app menu, shared by the tray and the status bar's ⋯ button.</summary>
    public ContextMenu BuildMenu()
    {
        var items = new List<Control>();
        foreach (var (label, action) in MenuEntries())
        {
            if (label is null) { items.Add(new Separator()); continue; }
            var item = new MenuItem { Header = label };
            item.Click += (_, _) => action!();
            items.Add(item);
        }
        return new ContextMenu { ItemsSource = items };
    }

    /// <summary>The same entries as a native menu for the tray icon.</summary>
    public NativeMenu BuildNativeMenu()
    {
        var menu = new NativeMenu();
        foreach (var (label, action) in MenuEntries())
        {
            if (label is null) { menu.Items.Add(new NativeMenuItemSeparator()); continue; }
            var item = new NativeMenuItem(label);
            item.Click += (_, _) => action!();
            menu.Items.Add(item);
        }
        return menu;
    }

    private IEnumerable<(string? Label, Action? Action)> MenuEntries()
    {
        yield return ("Open Fathom", ShowFromTray);
        yield return (null, null);
        if (updateStep is not null) yield return ($"Updating: {updateStep}", () => Platform.OpenExternal(Updater.LogPath));
        else if (updateStatus?.Available == true) yield return (UpdateLabel(updateStatus), () => _ = ConfirmUpdateAsync());
        else yield return ("Check for updates", () => _ = CheckForUpdatesAsync(announce: true));
        yield return (server.Owned || !server.IsListening() ? "Restart harness" : "Restart harness (stops the terminal server)", () => _ = RestartAsync());
        yield return ("Open log", () => Platform.OpenExternal(HarnessServer.LogPath));
        yield return ("Open update log", () => Platform.OpenExternal(Updater.LogPath));
        yield return ("Open in browser", () => Platform.OpenExternal(server.Url.ToString()));
        yield return ("Send test notification", SendTestNotification);
        yield return ((Platform.StartsAtLogin() ? "✓ " : "") + Platform.StartupLabel, () => Platform.SetStartsAtLogin(!Platform.StartsAtLogin()));
        yield return (null, null);
        yield return ("Quit", () => Quit());
    }

    // ── in-app update ───────────────────────────────────────────────────

    private static string UpdateLabel(Updater.Status status) => status.Behind > 0
        ? $"Update and restart ({status.Behind} new)"
        : "Rebuild and restart (new local code)";

    /// <summary>Check once now, then every few minutes: locally often, against the remote less often.</summary>
    private void StartUpdateChecks()
    {
        if (updateLoopStarted) return;
        updateLoopStarted = true;
        _ = Task.Run(async () =>
        {
            var lastFetch = DateTime.MinValue;
            while (!lifetime.IsCancellationRequested)
            {
                var fetch = DateTime.UtcNow - lastFetch > TimeSpan.FromMinutes(20);
                if (fetch) lastFetch = DateTime.UtcNow;
                await CheckForUpdatesAsync(announce: false, fetch);
                try { await Task.Delay(TimeSpan.FromMinutes(2), lifetime.Token); }
                catch (OperationCanceledException) { return; }
            }
        });
    }

    private async Task CheckForUpdatesAsync(bool announce, bool fetch = true)
    {
        if (updater.IsRunning) return;
        Updater.Status status;
        try { status = await updater.CheckAsync(fetch, lifetime.Token); }
        catch (OperationCanceledException) { return; }
        catch (Exception ex) { HarnessServer.AppLog($"update check failed: {ex.Message}"); return; }
        Dispatcher.UIThread.Post(() =>
        {
            updateStatus = status;
            PushChrome();
            if (!announce) return;
            if (status.Problem is not null) Notify("Cannot update", status.Problem, "update", urgent: false);
            else if (!status.Available) Notify("Fathom is up to date", status.Upstream is null ? "No upstream branch is set, and the build matches the checkout." : $"Nothing new on {status.Upstream}.", "update", urgent: false);
        });
    }

    /// <summary>Ask in the page (where the bar's button asks too), or run directly when no page is up.</summary>
    private async Task ConfirmUpdateAsync()
    {
        ShowFromTray();
        if (uiLoaded) await SafeScript("window.__phConfirmUpdate && window.__phConfirmUpdate()");
        else await UpdateAsync();
    }

    /// <summary>
    /// Pull, install and build while the harness keeps running, then restart
    /// it on the new build; when the app itself changed, reinstall it and
    /// reopen it on the same harness.
    /// </summary>
    private async Task UpdateAsync()
    {
        if (updater.IsRunning) return;
        void Step(string text) => Dispatcher.UIThread.Post(() =>
        {
            updateStep = text;
            PushChrome();
        });
        Updater.Outcome outcome;
        try
        {
            outcome = await Task.Run(() => updater.RunAsync(Step, lifetime.Token));
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            HarnessServer.AppLog($"update failed: {ex.Message}");
            updateStep = null;
            PushChrome();
            Notify("Update failed", ex.Message.Split('\n')[0] + " Open Update log from the ⋯ menu for details.", "update", urgent: false);
            Platform.OpenExternal(Updater.LogPath);
            return;
        }

        string? staged = null;
        if (outcome.DesktopChanged)
        {
            Step("Rebuilding the app…");
            var (folder, problem) = await Task.Run(() => updater.PublishAppAsync(lifetime.Token));
            staged = folder;
            if (problem is not null) Notify("App not updated", problem, "update", urgent: false);
        }

        Step("Restarting…");
        updateStatus = null;
        await RestartAsync();
        updateStep = null;
        PushChrome();
        _ = CheckForUpdatesAsync(announce: false, fetch: false);
        if (staged is not null && server.IsListening())
        {
            Updater.SwapAndRelaunch(staged);
            Quit(keepHarness: true);
        }
    }

    /// <summary>Play the sound and show a sample notification.</summary>
    public void SendTestNotification()
    {
        lastChime = DateTime.MinValue;
        HandleNotice(new Notice("question", "A question needs your answer", "Test: this is how Fathom asks for your input.", null), test: true);
    }

    /// <summary>Bring the window forward (tray click, second launch, notification).</summary>
    public void ShowFromTray()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = settings.Maximized ? WindowState.Maximized : WindowState.Normal;
        Activate();
    }

    private async Task RestartAsync()
    {
        if (!server.Owned && server.IsListening())
        {
            // A server started outside the app (a terminal) is replaced by one the app owns.
            foreach (var pid in HarnessServer.ListeningPids(settings.Port))
            {
                try
                {
                    using var process = Process.GetProcessById(pid);
                    if (process.ProcessName.StartsWith("node", StringComparison.OrdinalIgnoreCase)) process.Kill(entireProcessTree: true);
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
            }
            for (var i = 0; i < 30 && server.IsListening(); i++) await Task.Delay(200);
        }
        server.Stop();
        waiting = 0;
        uiLoaded = false;
        ShowFromTray();
        web.NavigateToString(Embedded.Text("splash.html"), new Uri("about:blank"));
        await Task.Delay(300);
        SetSplash("Restarting the harness…", false, "");
        await ConnectAsync();
    }

    /// <summary>
    /// Quit: stop the harness this app started (unless <paramref name="keepHarness"/>,
    /// used by `--quit --keep-harness` when updating the app) and exit.
    /// </summary>
    public void Quit(bool keepHarness = false)
    {
        quitting = true;
        lifetime.Cancel();
        SaveBounds();
        Quitting?.Invoke();
        if (keepHarness) server.Detach();
        else server.Stop();
        (Application.Current?.ApplicationLifetime as Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime)?.Shutdown();
    }

    private void SetSplash(string text, bool error, string hint)
    {
        if (uiLoaded) return;
        var call = $"window.setStatus && window.setStatus({JsonSerializer.Serialize(text)}, {(error ? "true" : "false")}, {JsonSerializer.Serialize(hint)})";
        Dispatcher.UIThread.Post(() => _ = SafeScript(call));
    }

    private void RestoreBounds_()
    {
        if (settings.Bounds is { Length: 4 } b && b[2] >= 720 && b[3] >= 480)
        {
            Position = new PixelPoint(b[0], b[1]);
            Width = b[2];
            Height = b[3];
            WindowStartupLocation = WindowStartupLocation.Manual;
        }
        else
        {
            Width = 1360;
            Height = 880;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        if (settings.Maximized) WindowState = WindowState.Maximized;
    }

    private void SaveBounds()
    {
        settings.Maximized = WindowState == WindowState.Maximized;
        if (WindowState == WindowState.Normal) settings.Bounds = [Position.X, Position.Y, (int)Width, (int)Height];
        settings.Save();
    }
}
