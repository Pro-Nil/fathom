using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;

namespace Fathom.Desktop;

/// <summary>The Avalonia application: theme, main window and tray icon.</summary>
internal sealed class App : Application
{
    /// <summary>Set by Program before start: launched hidden (start at login).</summary>
    public static bool StartHidden { get; set; }

    /// <summary>The window, once created (single-instance commands reach it here).</summary>
    public static MainWindow? Window { get; private set; }

    public override void Initialize()
    {
        Styles.Add(new FluentTheme());
        RequestedThemeVariant = ThemeVariant.Dark;
        Name = "Fathom";
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            // Closing the window hides it; only Quit ends the app.
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var settings = AppSettings.Load();
            var window = new MainWindow(settings);
            Window = window;

            var tray = new TrayIcon
            {
                Icon = new WindowIcon(Embedded.Open("app.png")),
                ToolTipText = "Fathom",
                Menu = window.BuildNativeMenu(),
                IsVisible = true,
            };
            tray.Clicked += (_, _) => window.ShowFromTray();
            // Rebuild the menu each time it may be shown, so labels stay current.
            window.TipChanged += tip =>
            {
                tray.ToolTipText = tip.Length > 120 ? tip[..119] + "…" : tip;
                tray.Menu = window.BuildNativeMenu();
            };
            window.Quitting += () => tray.IsVisible = false;
            TrayIcon.SetIcons(this, [tray]);

            if (StartHidden)
            {
                // Started at login: run the harness but stay in the tray.
                window.Opened += (_, _) => Dispatcher.UIThread.Post(window.Hide);
            }
            window.Show();
        }
        base.OnFrameworkInitializationCompleted();
    }
}
