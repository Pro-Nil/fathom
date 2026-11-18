using System.Diagnostics;
using System.Media;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace PentestHarness.Desktop;

/// <summary>
/// The app window. Closing it (the X) hides it to the tray; only Quit from the
/// tray menu exits, which also stops the harness the app started.
/// </summary>
internal sealed class MainForm : Form
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "PentestHarness";

    private readonly AppSettings settings;
    private readonly HarnessServer server;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 11, 13) };
    private readonly TrayIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem startupItem;
    private readonly SoundPlayer chime;
    private readonly bool startHidden;
    private readonly CancellationTokenSource lifetime = new();
    private bool quitting;
    private bool uiLoaded;
    private int waiting;
    private string serverState = "starting";
    private DateTime lastChime = DateTime.MinValue;

    public MainForm(AppSettings settings, bool startHidden)
    {
        this.settings = settings;
        this.startHidden = startHidden;
        server = new HarnessServer(settings);
        server.Exited += code => BeginInvoke(() => OnServerExited(code));

        Text = "Pentest Harness";
        Icon = LoadIcon(32);
        BackColor = Color.FromArgb(11, 11, 13);
        MinimumSize = new Size(720, 480);
        StartPosition = FormStartPosition.Manual;
        RestoreBounds_();
        Controls.Add(web);

        chime = new SoundPlayer(Resource("notify.wav"));
        chime.Load();

        menu = BuildMenu(out startupItem);
        tray = new TrayIcon(LoadIcon(16), LoadIcon(64), "Pentest Harness");
        tray.Activated += ShowFromTray;
        tray.NotificationClicked += ShowFromTray;
        tray.MenuRequested += ShowMenu;
    }

    // ── startup ─────────────────────────────────────────────────────────

    protected override void SetVisibleCore(bool value)
    {
        // Launched with --tray (Start with Windows): run, but stay hidden.
        if (startHidden && !IsHandleCreated)
        {
            CreateHandle();
            value = false;
        }
        base.SetVisibleCore(value);
    }

    protected override async void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UseDarkTitleBar(Handle);
        // Recompute the frame now that WM_NCCALCSIZE drops the caption.
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0020 | 0x0002 | 0x0001 | 0x0004 /* FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER */);
        UpdateResizeStrip();
        await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppSettings.Folder, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Microsoft Edge WebView2 Runtime is required. Install it from Microsoft and start Pentest Harness again.", "Pentest Harness", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        // The page's title bar marks its empty space app-region: drag, which
        // WebView2 turns into a real caption (drag, double-click, snap, system menu).
        core.Settings.IsNonClientRegionSupportEnabled = true;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(ReadText("bridge.js"));
        core.WebMessageReceived += OnWebMessage;
        core.NewWindowRequested += (_, args) =>
        {
            // Links that open a new window go to the default browser.
            args.Handled = true;
            OpenExternal(args.Uri);
        };
        core.NavigationStarting += (_, args) =>
        {
            if (!uiLoaded || args.Uri.StartsWith("data:", StringComparison.Ordinal)) return;
            var target = new Uri(args.Uri);
            if (target.Host is "127.0.0.1" or "localhost" && target.Port == settings.Port) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        };
        core.ProcessFailed += (_, args) =>
        {
            if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
            BeginInvoke(() => web.Reload());
        };

        core.NavigateToString(ReadText("splash.html"));
        await WaitForNavigation(core);
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
            PushChrome();
            web.CoreWebView2.Navigate(server.Url.ToString());
            tray.SetTip(server.Owned ? "Pentest Harness" : "Pentest Harness (attached to a running server)");
            UpdateMenu();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            SetSplash(ex.Message, true, "Use the ⋯ menu above (or the tray menu) to retry or open the log.");
            if (!Visible) ShowFromTray();
        }
    }

    private void OnServerExited(int code)
    {
        if (quitting) return;
        serverState = "stopped";
        PushChrome();
        UpdateMenu();
        Notify("Pentest Harness stopped", $"The harness exited (code {code}). Use Restart harness in the tray menu.", "stopped", urgent: false);
        PlayChime();
    }

    // ── notifications ───────────────────────────────────────────────────

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        string? json;
        try { json = args.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
        if (json is null) return;
        Notice? notice;
        try { notice = JsonSerializer.Deserialize<Notice>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch (JsonException) { return; }
        if (notice is null) return;
        if (notice.Kind == "theme")
        {
            ApplyTheme(notice.Dark == true, notice.Background);
            return;
        }
        if (notice.Kind == "window")
        {
            HandleWindowAction(notice.Action);
            return;
        }
        HandleNotice(notice, test: false);
    }

    private void HandleNotice(Notice notice, bool test)
    {
        if (notice.Kind == "resolved")
        {
            waiting = Math.Max(0, waiting - 1);
            tray.SetTip(waiting == 0 ? "Pentest Harness" : $"Pentest Harness — {waiting} waiting for you");
            PushChrome();
            return;
        }
        if (!test)
        {
            waiting++;
            tray.SetTip($"Pentest Harness — {waiting} waiting for you");
            PushChrome();
        }
        PlayChime();
        var focused = Visible && WindowState != FormWindowState.Minimized && GetForegroundWindow() == Handle;
        if (test || !focused || settings.NotifyWhenFocused) Notify(notice.Title ?? "Pentest Harness needs you", notice.Body ?? "", notice.Kind ?? "input", urgent: true);
        if (!focused) FlashTaskbar();
    }

    /// <summary>Windows toast; the tray balloon is the fallback if toasts are unavailable.</summary>
    private void Notify(string title, string body, string tag, bool urgent)
    {
        try
        {
            Toasts.Show(title, body, tag, urgent);
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or UnauthorizedAccessException)
        {
            tray.Notify(title, body);
        }
    }

    private void PlayChime()
    {
        // Several parallel requests arrive together: one chime is enough.
        if ((DateTime.UtcNow - lastChime).TotalMilliseconds < 1500) return;
        lastChime = DateTime.UtcNow;
        try { chime.Play(); } catch (InvalidOperationException) { }
    }

    private sealed record Notice(string? Kind, string? Title, string? Body, string? SessionId, bool? Dark = null, string? Background = null, string? Action = null);

    // ── custom title bar ────────────────────────────────────────────────

    /// <summary>Buttons in the page's title bar.</summary>
    private void HandleWindowAction(string? action)
    {
        switch (action)
        {
            case "ready": PushChrome(); break;
            case "minimize": WindowState = FormWindowState.Minimized; break;
            case "maximize": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
            case "close": Close(); break;
            case "reload": if (uiLoaded) web.Reload(); break;
            case "external": OpenExternal(server.Url.ToString()); break;
            case "menu":
                UpdateMenu();
                startupItem.Checked = StartsWithWindows();
                menu.Show(Cursor.Position, ToolStripDropDownDirection.BelowLeft);
                break;
        }
    }

    /// <summary>Send the bar what it shows: server state, port, waiting count, maximized.</summary>
    private void PushChrome()
    {
        if (web.CoreWebView2 is null) return;
        var state = JsonSerializer.Serialize(new
        {
            type = "chrome",
            state = serverState,
            port = settings.Port,
            waiting,
            maximized = WindowState == FormWindowState.Maximized,
        });
        try { web.CoreWebView2.PostWebMessageAsJson(state); } catch (InvalidOperationException) { }
    }

    private FormWindowState lastState = FormWindowState.Normal;

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        UpdateResizeStrip();
        if (WindowState != lastState)
        {
            lastState = WindowState;
            PushChrome();
        }
    }

    /// <summary>A thin top strip outside the web view keeps the top edge resizable.</summary>
    private void UpdateResizeStrip()
    {
        var top = WindowState == FormWindowState.Normal ? 3 : 0;
        if (Padding.Top != top) Padding = new Padding(0, top, 0, 0);
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_NCCALCSIZE = 0x0083, WM_NCHITTEST = 0x0084;
        if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
        {
            // Let Windows size the side and bottom borders, then put the top
            // back where it was: the caption disappears, the frame (resize
            // borders, shadow, rounded corners, snap) stays.
            var before = Marshal.PtrToStructure<RECT>(m.LParam);
            base.WndProc(ref m);
            var after = Marshal.PtrToStructure<RECT>(m.LParam);
            after.Top = before.Top + (IsZoomed(Handle) ? FrameInset() : 0);
            Marshal.StructureToPtr(after, m.LParam, false);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == WM_NCHITTEST)
        {
            base.WndProc(ref m);
            if (m.Result == (IntPtr)1 /* HTCLIENT */ && WindowState == FormWindowState.Normal)
            {
                var lp = m.LParam.ToInt64();
                var point = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
                if (point.Y < Math.Max(Padding.Top, 3))
                {
                    m.Result = point.X < 10 ? (IntPtr)13 /* HTTOPLEFT */ : point.X > ClientSize.Width - 10 ? (IntPtr)14 /* HTTOPRIGHT */ : (IntPtr)12 /* HTTOP */;
                }
            }
            return;
        }
        base.WndProc(ref m);
    }

    private int FrameInset()
    {
        var dpi = GetDpiForWindow(Handle);
        return GetSystemMetricsForDpi(33 /* SM_CYFRAME */, dpi) + GetSystemMetricsForDpi(92 /* SM_CXPADDEDBORDER */, dpi);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);


    /// <summary>Match the native title bar and window background to the page palette.</summary>
    private void ApplyTheme(bool dark, string? background)
    {
        var color = ParseCssColor(background) ?? (dark ? Color.FromArgb(11, 11, 13) : Color.White);
        BackColor = color;
        web.DefaultBackgroundColor = color;
        var on = dark ? 1 : 0;
        DwmSetWindowAttribute(Handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref on, sizeof(int));
        var caption = color.R | (color.G << 8) | (color.B << 16); // COLORREF 0x00BBGGRR
        DwmSetWindowAttribute(Handle, 35 /* DWMWA_CAPTION_COLOR */, ref caption, sizeof(int));
        var text = dark ? 0x00ECE8E8 : 0x001A1717;
        DwmSetWindowAttribute(Handle, 36 /* DWMWA_TEXT_COLOR */, ref text, sizeof(int));
    }

    /// <summary>Parse <c>rgb(r, g, b)</c> / <c>rgba(...)</c> from getComputedStyle.</summary>
    private static Color? ParseCssColor(string? css)
    {
        if (css is null) return null;
        var match = System.Text.RegularExpressions.Regex.Match(css, @"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)");
        if (!match.Success) return null;
        if (match.Groups[4].Success && double.TryParse(match.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture, out var alpha) && alpha < 0.5) return null;
        return Color.FromArgb(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value));
    }

    // ── window / tray ───────────────────────────────────────────────────

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!quitting && e.CloseReason is CloseReason.UserClosing)
        {
            // The X hides to the tray; the harness keeps running.
            e.Cancel = true;
            SaveBounds();
            Hide();
            if (!settings.TrayHintShown)
            {
                settings.TrayHintShown = true;
                settings.Save();
                Notify("Still running in the tray", "Pentest Harness keeps working in the background. Right-click the tray icon and choose Quit to close it.", "tray", urgent: false);
            }
            return;
        }
        base.OnFormClosing(e);
    }

    /// <summary>Play the sound and show a sample notification.</summary>
    public void SendTestNotification()
    {
        lastChime = DateTime.MinValue;
        HandleNotice(new Notice("question", "A question needs your answer", "Test: this is how Pentest Harness asks for your input.", null), test: true);
    }

    /// <summary>Bring the window forward (used by a second launch).</summary>
    public void BringToFront_() => ShowFromTray();

    private void ShowFromTray()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        Activate();
        SetForegroundWindow(Handle);
        if (uiLoaded) web.Focus();
    }

    private ContextMenuStrip BuildMenu(out ToolStripMenuItem startup)
    {
        var strip = new ContextMenuStrip { Renderer = new DarkMenuRenderer(), ShowImageMargin = false, Font = new Font("Segoe UI", 9.5f) };
        strip.Items.Add(new ToolStripMenuItem("Open Pentest Harness", null, (_, _) => ShowFromTray()) { Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) });
        strip.Items.Add(new ToolStripSeparator());
        strip.Items.Add(new ToolStripMenuItem("Restart harness", null, async (_, _) => await RestartAsync()) { Name = "restart" });
        strip.Items.Add(new ToolStripMenuItem("Open log", null, (_, _) => OpenExternal(HarnessServer.LogPath)));
        strip.Items.Add(new ToolStripMenuItem("Open in browser", null, (_, _) => OpenExternal(server.Url.ToString())));
        strip.Items.Add(new ToolStripMenuItem("Send test notification", null, (_, _) => SendTestNotification()));
        startup = new ToolStripMenuItem("Start with Windows", null, (_, _) => ToggleStartup()) { Checked = StartsWithWindows() };
        strip.Items.Add(startup);
        strip.Items.Add(new ToolStripSeparator());
        strip.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => Quit()));
        foreach (ToolStripItem item in strip.Items) item.ForeColor = Color.FromArgb(232, 232, 236);
        return strip;
    }

    private void UpdateMenu()
    {
        if (menu.Items["restart"] is ToolStripMenuItem restart)
        {
            restart.Text = server.Owned || !server.IsListening() ? "Restart harness" : "Restart harness (stops the terminal server)";
        }
    }

    private void ShowMenu()
    {
        UpdateMenu();
        startupItem.Checked = StartsWithWindows();
        // Foreground first so the menu closes when the user clicks elsewhere.
        SetForegroundWindow(Handle);
        menu.Show(Cursor.Position, ToolStripDropDownDirection.AboveLeft);
    }

    private async Task RestartAsync()
    {
        if (!server.Owned && server.IsListening())
        {
            var answer = MessageBox.Show(this,
                "The harness was started outside this app (for example from a terminal). Restarting stops that server and starts a new one owned by this app.\n\nRestart it?",
                "Restart harness", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
            if (answer != DialogResult.OK) return;
            KillExternalServer();
        }
        server.Stop();
        waiting = 0;
        ShowFromTray();
        web.CoreWebView2.NavigateToString(ReadText("splash.html"));
        await WaitForNavigation(web.CoreWebView2);
        SetSplash("Restarting the harness…", false, "");
        await ConnectAsync();
    }

    /// <summary>Stop a server the app did not start: the process listening on the port.</summary>
    private void KillExternalServer()
    {
        foreach (var pid in ListeningPids(settings.Port))
        {
            try
            {
                using var process = Process.GetProcessById(pid);
                if (process.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) process.Kill(entireProcessTree: true);
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
        for (var i = 0; i < 30 && server.IsListening(); i++) Thread.Sleep(200);
    }

    private static IEnumerable<int> ListeningPids(int port)
    {
        var info = new ProcessStartInfo("netstat", "-ano -p TCP") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
        using var netstat = Process.Start(info);
        if (netstat is null) yield break;
        var output = netstat.StandardOutput.ReadToEnd();
        foreach (var line in output.Split('\n'))
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 5 && parts[3] == "LISTENING" && parts[1].EndsWith($":{port}", StringComparison.Ordinal) && int.TryParse(parts[4], out var pid)) yield return pid;
        }
    }

    /// <summary>Quit as the tray menu does (used by `--quit`).</summary>
    public void QuitApp() => Quit();

    private void Quit()
    {
        quitting = true;
        lifetime.Cancel();
        SaveBounds();
        tray.Dispose();
        server.Stop();
        Application.Exit();
    }

    private static bool StartsWithWindows()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunValue) is string;
    }

    private void ToggleStartup()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (StartsWithWindows()) key.DeleteValue(RunValue, false);
        else key.SetValue(RunValue, $"\"{Environment.ProcessPath}\" --tray");
        startupItem.Checked = StartsWithWindows();
    }

    private void SetSplash(string text, bool error, string hint)
    {
        if (web.CoreWebView2 is null || uiLoaded) return;
        var call = $"window.setStatus && window.setStatus({JsonSerializer.Serialize(text)}, {(error ? "true" : "false")}, {JsonSerializer.Serialize(hint)})";
        _ = web.CoreWebView2.ExecuteScriptAsync(call);
    }

    private static Task WaitForNavigation(CoreWebView2 core)
    {
        var done = new TaskCompletionSource();
        void Handler(object? s, CoreWebView2NavigationCompletedEventArgs e)
        {
            core.NavigationCompleted -= Handler;
            done.TrySetResult();
        }
        core.NavigationCompleted += Handler;
        return Task.WhenAny(done.Task, Task.Delay(3000));
    }

    private void RestoreBounds_()
    {
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1440, 900);
        var bounds = settings.Bounds is { Length: 4 } b ? new Rectangle(b[0], b[1], b[2], b[3]) : Rectangle.Empty;
        if (bounds.Width < 720 || bounds.Height < 480 || !Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds)))
        {
            var width = Math.Min(1360, area.Width - 80);
            var height = Math.Min(880, area.Height - 80);
            bounds = new Rectangle(area.Left + (area.Width - width) / 2, area.Top + (area.Height - height) / 2, width, height);
        }
        Bounds = bounds;
        if (settings.Maximized) WindowState = FormWindowState.Maximized;
    }

    private void SaveBounds()
    {
        var rect = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        settings.Bounds = [rect.X, rect.Y, rect.Width, rect.Height];
        settings.Maximized = WindowState == FormWindowState.Maximized;
        settings.Save();
    }

    private static void OpenExternal(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { }
    }

    // ── resources and native helpers ────────────────────────────────────

    private static Stream Resource(string name) =>
        Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new InvalidOperationException($"missing resource {name}");

    private static string ReadText(string name)
    {
        using var reader = new StreamReader(Resource(name));
        return reader.ReadToEnd();
    }

    private static Icon LoadIcon(int size)
    {
        using var stream = Resource("app.ico");
        return new Icon(stream, new Size(size, size));
    }

    private void FlashTaskbar()
    {
        var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(), hwnd = Handle, dwFlags = 0x3 | 0xC /* ALL | TIMERNOFG */, uCount = 3 };
        FlashWindowEx(ref info);
    }

    private static void UseDarkTitleBar(IntPtr hwnd)
    {
        var on = 1;
        DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref on, sizeof(int));
        var caption = 0x000D0B0B; // COLORREF 0x00BBGGRR for #0b0b0d
        DwmSetWindowAttribute(hwnd, 35 /* DWMWA_CAPTION_COLOR */, ref caption, sizeof(int));
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            web.Dispose();
            menu.Dispose();
            chime.Dispose();
            lifetime.Dispose();
        }
        base.Dispose(disposing);
    }

    /// <summary>Dark tray menu matching the app.</summary>
    private sealed class DarkMenuRenderer() : ToolStripProfessionalRenderer(new DarkColors())
    {
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = Color.FromArgb(232, 232, 236);
            base.OnRenderItemText(e);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            var r = new Rectangle(e.ImageRectangle.X, e.ImageRectangle.Y, e.ImageRectangle.Width, e.ImageRectangle.Height);
            using var pen = new Pen(Color.FromArgb(59, 130, 246), 2);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            e.Graphics.DrawLines(pen, [new Point(r.Left + 3, r.Top + r.Height / 2), new Point(r.Left + r.Width / 2 - 1, r.Bottom - 4), new Point(r.Right - 3, r.Top + 4)]);
        }
    }

    private sealed class DarkColors : ProfessionalColorTable
    {
        private static readonly Color Back = Color.FromArgb(24, 24, 28);
        private static readonly Color Hover = Color.FromArgb(40, 40, 46);
        private static readonly Color Line = Color.FromArgb(52, 52, 58);
        public override Color ToolStripDropDownBackground => Back;
        public override Color ImageMarginGradientBegin => Back;
        public override Color ImageMarginGradientMiddle => Back;
        public override Color ImageMarginGradientEnd => Back;
        public override Color MenuBorder => Line;
        public override Color MenuItemBorder => Hover;
        public override Color MenuItemSelected => Hover;
        public override Color SeparatorDark => Line;
        public override Color SeparatorLight => Back;
        public override Color CheckBackground => Back;
        public override Color CheckSelectedBackground => Hover;
        public override Color CheckPressedBackground => Hover;
    }
}
