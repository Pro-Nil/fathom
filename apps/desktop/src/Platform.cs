using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia.Controls;
using Avalonia.Platform;

namespace PentestHarness.Desktop;

/// <summary>
/// Everything that differs between Windows and Linux: notifications, the
/// chime, start-with-the-desktop, drawing attention to the window, and putting
/// the bridge script into every document before the page's own scripts run.
/// </summary>
internal static class Platform
{
    public static bool IsWindows => OperatingSystem.IsWindows();

    /// <summary>Label of the start-at-login menu item.</summary>
    public static string StartupLabel => IsWindows ? "Start with Windows" : "Start at login";

    // ── setup ───────────────────────────────────────────────────────────

    /// <summary>One-time registration: toast identity on Windows, a menu launcher on Linux.</summary>
    public static void Register()
    {
#if WINDOWS
        try { Toasts.Register(Path.Combine(AppContext.BaseDirectory, "app.png")); }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException) { }
#else
        if (OperatingSystem.IsLinux()) InstallLinuxLauncher();
#endif
    }

    /// <summary>
    /// Write ~/.local/share/applications/pentest-harness.desktop (and its icon)
    /// so the app shows in the desktop's application menu.
    /// </summary>
    private static void InstallLinuxLauncher()
    {
        try
        {
            var data = Environment.GetEnvironmentVariable("XDG_DATA_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(Home, ".local", "share");
            var icons = Path.Combine(data, "icons", "hicolor", "256x256", "apps");
            Directory.CreateDirectory(icons);
            var icon = Path.Combine(icons, "pentest-harness.png");
            using (var source = Embedded.Open("app.png"))
            using (var target = File.Create(icon)) source.CopyTo(target);
            var apps = Path.Combine(data, "applications");
            Directory.CreateDirectory(apps);
            File.WriteAllText(Path.Combine(apps, "pentest-harness.desktop"), DesktopEntry(icon, tray: false));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    private static string DesktopEntry(string icon, bool tray) => string.Join('\n',
        "[Desktop Entry]",
        "Type=Application",
        "Name=Pentest Harness",
        "Comment=Pentest Harness desktop app",
        $"Exec=\"{Environment.ProcessPath}\"{(tray ? " --tray" : "")}",
        $"Icon={icon}",
        "Terminal=false",
        "Categories=Development;Security;",
        "StartupWMClass=PentestHarness",
        "") ;

    // ── notifications ───────────────────────────────────────────────────

    /// <summary>
    /// Show a desktop notification: a Windows toast, or libnotify's
    /// notify-send on Linux. Returns false when neither is available, so the
    /// caller can fall back to the tray.
    /// </summary>
    public static bool Notify(string title, string body, string tag, bool urgent)
    {
#if WINDOWS
        try
        {
            Toasts.Show(title, body, tag, urgent);
            return true;
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or UnauthorizedAccessException)
        {
            return false;
        }
#else
        var icon = Path.Combine(AppContext.BaseDirectory, "app.png");
        return Run("notify-send", ["--app-name=Pentest Harness", $"--icon={icon}", $"--urgency={(urgent ? "critical" : "normal")}", "--hint=string:x-canonical-private-synchronous:" + tag, title, body]);
#endif
    }

    // ── sound ───────────────────────────────────────────────────────────

    private static string? chimeFile;

    /// <summary>Play the app's chime without blocking.</summary>
    public static void PlayChime()
    {
        chimeFile ??= ExtractChime();
        if (chimeFile is null) return;
#if WINDOWS
        PlaySound(chimeFile, IntPtr.Zero, 0x0001 /* SND_ASYNC */ | 0x00020000 /* SND_FILENAME */ | 0x0002 /* SND_NODEFAULT */);
#else
        // PipeWire, PulseAudio, then plain ALSA.
        _ = Run("pw-play", [chimeFile]) || Run("paplay", [chimeFile]) || Run("aplay", ["-q", chimeFile]);
#endif
    }

    private static string? ExtractChime()
    {
        try
        {
            Directory.CreateDirectory(AppSettings.Folder);
            var path = Path.Combine(AppSettings.Folder, "notify.wav");
            using var source = Embedded.Open("notify.wav");
            using var target = File.Create(path);
            source.CopyTo(target);
            return path;
        }
        catch (IOException)
        {
            return null;
        }
    }

    // ── start at login ──────────────────────────────────────────────────

    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "PentestHarness";

    private static string AutostartFile => Path.Combine(
        Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(Home, ".config"),
        "autostart", "pentest-harness.desktop");

    public static bool StartsAtLogin()
    {
#if WINDOWS
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunValue) is string;
#else
        return File.Exists(AutostartFile);
#endif
    }

    public static void SetStartsAtLogin(bool on)
    {
#if WINDOWS
        using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) key.SetValue(RunValue, $"\"{Environment.ProcessPath}\" --tray");
        else key.DeleteValue(RunValue, false);
#else
        try
        {
            if (on)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(AutostartFile)!);
                File.WriteAllText(AutostartFile, DesktopEntry(Path.Combine(AppContext.BaseDirectory, "app.png"), tray: true));
            }
            else
            {
                File.Delete(AutostartFile);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
#endif
    }

    // ── attention ───────────────────────────────────────────────────────

    /// <summary>Flash the taskbar button (Windows); Linux relies on the notification.</summary>
    public static void RequestAttention(Window window)
    {
#if WINDOWS
        if (window.TryGetPlatformHandle()?.Handle is not { } hwnd || hwnd == IntPtr.Zero) return;
        var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(), hwnd = hwnd, dwFlags = 0x3 | 0xC /* ALL | TIMERNOFG */, uCount = 3 };
        FlashWindowEx(ref info);
#endif
    }

    /// <summary>Open a URL or file with the desktop's default handler.</summary>
    public static void OpenExternal(string target)
    {
        if (IsWindows)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { }
            return;
        }
        Run("xdg-open", [target]);
    }

    /// <summary>Start a helper program without waiting; false when it cannot start.</summary>
    private static bool Run(string file, string[] args)
    {
        try
        {
            var info = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var arg in args) info.ArgumentList.Add(arg);
            using var process = Process.Start(info);
            return process is not null;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    // ── bridge injection ────────────────────────────────────────────────

    /// <summary>
    /// Register <paramref name="script"/> to run at the start of every top-level
    /// document, before the page's own scripts (the bridge must wrap WebSocket
    /// before the UI opens its event stream). Uses the native web view behind
    /// the adapter: WebView2's AddScriptToExecuteOnDocumentCreated on Windows,
    /// a WebKit user script on Linux. Returns false when neither is reachable;
    /// the window then injects the script after each load instead.
    /// </summary>
    public static bool InjectAtDocumentStart(IPlatformHandle? handle, string script, Action<string>? log = null)
    {
        try
        {
#if WINDOWS
            if (handle is IWindowsWebView2PlatformHandle webView2 && webView2.CoreWebView2 != IntPtr.Zero)
            {
                var core = Microsoft.Web.WebView2.Core.CoreWebView2.CreateFromComICoreWebView2(webView2.CoreWebView2);
                core.AddScriptToExecuteOnDocumentCreatedAsync(script).ContinueWith(
                    task => log?.Invoke(task.IsFaulted ? $"WebView2 document-start script failed: {task.Exception?.GetBaseException().Message}" : $"WebView2 document-start script registered ({task.Result})"),
                    TaskScheduler.Default);
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                return true;
            }
#endif
            var view = handle switch
            {
                IGtkWebViewPlatformHandle gtk => gtk.WebKitWebView,
                ILinuxWpePlatformHandle wpe => wpe.WebKitWebView,
                _ => IntPtr.Zero,
            };
            if (view != IntPtr.Zero) return WebKit.AddUserScript(view, script, handle is ILinuxWpePlatformHandle);
        }
        catch (Exception ex)
        {
            log?.Invoke($"bridge injection failed: {ex.GetType().Name}: {ex.Message}");
        }
        return false;
    }

#if WINDOWS
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
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern bool PlaySound(string sound, IntPtr module, uint flags);
#endif
}

/// <summary>
/// WebKit user scripts on Linux, through the WebKitGTK or WPE WebKit shared
/// library the WebView adapter already loaded. WebKit objects belong to the
/// GLib main loop's thread, so the calls run there through g_idle_add.
/// </summary>
internal static unsafe class WebKit
{
    private static readonly string[] GtkLibraries = ["libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.0.so.37", "libwebkitgtk-6.0.so.4"];
    private static readonly string[] WpeLibraries = ["libWPEWebKit-2.0.so.1", "libWPEWebKit-1.1.so.0", "libWPEWebKit-1.0.so.3"];

    private sealed class Pending
    {
        public required IntPtr View;
        public required IntPtr Script;
        public required delegate* unmanaged<IntPtr, IntPtr> GetManager;
        public required delegate* unmanaged<IntPtr, int, int, IntPtr, IntPtr, IntPtr> NewScript;
        public required delegate* unmanaged<IntPtr, IntPtr, void> AddScript;
        public required delegate* unmanaged<IntPtr, void> UnrefScript;
    }

    public static bool AddUserScript(IntPtr view, string source, bool wpe)
    {
        IntPtr lib = IntPtr.Zero;
        foreach (var name in wpe ? WpeLibraries : GtkLibraries)
        {
            if (NativeLibrary.TryLoad(name, out lib)) break;
        }
        if (lib == IntPtr.Zero || !NativeLibrary.TryLoad("libglib-2.0.so.0", out var glib)) return false;
        var pending = new Pending
        {
            View = view,
            Script = Marshal.StringToCoTaskMemUTF8(source),
            GetManager = (delegate* unmanaged<IntPtr, IntPtr>)NativeLibrary.GetExport(lib, "webkit_web_view_get_user_content_manager"),
            NewScript = (delegate* unmanaged<IntPtr, int, int, IntPtr, IntPtr, IntPtr>)NativeLibrary.GetExport(lib, "webkit_user_script_new"),
            AddScript = (delegate* unmanaged<IntPtr, IntPtr, void>)NativeLibrary.GetExport(lib, "webkit_user_content_manager_add_script"),
            UnrefScript = (delegate* unmanaged<IntPtr, void>)NativeLibrary.GetExport(lib, "webkit_user_script_unref"),
        };
        var idleAdd = (delegate* unmanaged<delegate* unmanaged<IntPtr, int>, IntPtr, uint>)NativeLibrary.GetExport(glib, "g_idle_add");
        idleAdd(&OnIdle, GCHandle.ToIntPtr(GCHandle.Alloc(pending)));
        return true;
    }

    [UnmanagedCallersOnly]
    private static int OnIdle(IntPtr state)
    {
        var handle = GCHandle.FromIntPtr(state);
        var pending = (Pending)handle.Target!;
        handle.Free();
        try
        {
            var manager = pending.GetManager(pending.View);
            // WEBKIT_USER_CONTENT_INJECT_TOP_FRAME = 1, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START = 0
            var script = pending.NewScript(pending.Script, 1, 0, IntPtr.Zero, IntPtr.Zero);
            pending.AddScript(manager, script);
            pending.UnrefScript(script);
        }
        finally
        {
            Marshal.FreeCoTaskMem(pending.Script);
        }
        return 0; // G_SOURCE_REMOVE
    }
}

/// <summary>Embedded resources.</summary>
internal static class Embedded
{
    public static Stream Open(string name) =>
        typeof(Embedded).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"missing resource {name}");

    public static string Text(string name)
    {
        using var reader = new StreamReader(Open(name));
        return reader.ReadToEnd();
    }
}
