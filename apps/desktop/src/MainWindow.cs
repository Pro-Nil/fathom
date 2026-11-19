using System.Diagnostics;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Threading;

namespace PentestHarness.Desktop;

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

        Title = "Pentest Harness";
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
        // the status bar's ⋯ button.
        menuAnchor = new Border { Width = 1, Height = 34, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 0, 12, 0) };
        Content = new Grid { Children = { web, menuAnchor } };

        Opened += async (_, _) => await StartAsync();
        Closing += OnClosing;
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
                gtk.ApplicationNameForUserAgent = "PentestHarness";
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
            TipChanged?.Invoke(server.Owned ? "Pentest Harness" : "Pentest Harness (attached to a running server)");
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
        Notify("Pentest Harness stopped", $"The harness exited (code {code}). Use Restart harness in the tray menu.", "stopped", urgent: false);
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
                case "window": HandleWindowAction(notice.Action); break;
                default: HandleNotice(notice, test: false); break;
            }
        });
    }

    private void HandleNotice(Notice notice, bool test)
    {
        if (notice.Kind == "resolved")
        {
            waiting = Math.Max(0, waiting - 1);
            TipChanged?.Invoke(waiting == 0 ? "Pentest Harness" : $"Pentest Harness — {waiting} waiting for you");
            PushChrome();
            return;
        }
        if (!test)
        {
            waiting++;
            TipChanged?.Invoke($"Pentest Harness — {waiting} waiting for you");
            PushChrome();
        }
        PlayChime();
        var focused = IsVisible && WindowState != WindowState.Minimized && IsActive;
        if (test || !focused || settings.NotifyWhenFocused) Notify(notice.Title ?? "Pentest Harness needs you", notice.Body ?? "", notice.Kind ?? "input", urgent: true);
        if (!focused) Platform.RequestAttention(this);
    }

    private void HandleWindowAction(string? action)
    {
        switch (action)
        {
            case "ready": PushChrome(); break;
            case "reload": if (uiLoaded) web.Refresh(); break;
            case "external": Platform.OpenExternal(server.Url.ToString()); break;
            case "menu":
                var menu = BuildMenu();
                menu.PlacementTarget = menuAnchor;
                menu.Placement = PlacementMode.BottomEdgeAlignedRight;
                menu.Open(menuAnchor);
                break;
        }
    }

    /// <summary>Send the status bar what it shows: server state, port, waiting count.</summary>
    private void PushChrome()
    {
        if (!uiLoaded) return;
        var state = JsonSerializer.Serialize(new { type = "chrome", state = serverState, port = settings.Port, waiting });
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
            Notify("Still running in the tray", "Pentest Harness keeps working in the background. Use the tray icon's Quit to close it.", "tray", urgent: false);
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
        yield return ("Open Pentest Harness", ShowFromTray);
        yield return (null, null);
        yield return (server.Owned || !server.IsListening() ? "Restart harness" : "Restart harness (stops the terminal server)", () => _ = RestartAsync());
        yield return ("Open log", () => Platform.OpenExternal(HarnessServer.LogPath));
        yield return ("Open in browser", () => Platform.OpenExternal(server.Url.ToString()));
        yield return ("Send test notification", SendTestNotification);
        yield return ((Platform.StartsAtLogin() ? "✓ " : "") + Platform.StartupLabel, () => Platform.SetStartsAtLogin(!Platform.StartsAtLogin()));
        yield return (null, null);
        yield return ("Quit", () => Quit());
    }

    /// <summary>Play the sound and show a sample notification.</summary>
    public void SendTestNotification()
    {
        lastChime = DateTime.MinValue;
        HandleNotice(new Notice("question", "A question needs your answer", "Test: this is how Pentest Harness asks for your input.", null), test: true);
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
