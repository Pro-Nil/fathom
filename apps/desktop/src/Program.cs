namespace PentestHarness.Desktop;

internal static class Program
{
    private const string MutexName = @"Local\PentestHarness.Desktop";
    private const string ShowEventName = @"Local\PentestHarness.Desktop.Show";
    private const string TestEventName = @"Local\PentestHarness.Desktop.TestNotification";
    private const string QuitEventName = @"Local\PentestHarness.Desktop.Quit";

    [STAThread]
    private static void Main(string[] args)
    {
        // One instance: a second launch (Start menu, shortcut) just brings the
        // running window forward.
        using var mutex = new Mutex(true, MutexName, out var first);
        if (first && args.Contains("--quit", StringComparer.OrdinalIgnoreCase)) return;
        if (!first)
        {
            // `--test-notification` asks the running app to play its sound and
            // show a sample notification; any other launch brings it forward.
            // `--quit` closes the running app the same way the tray's Quit does.
            var name = args.Contains("--test-notification", StringComparer.OrdinalIgnoreCase) ? TestEventName
                : args.Contains("--quit", StringComparer.OrdinalIgnoreCase) ? QuitEventName
                : ShowEventName;
            try
            {
                using var signal = EventWaitHandle.OpenExisting(name);
                signal.Set();
            }
            catch (WaitHandleCannotBeOpenedException) { }
            return;
        }

        ApplicationConfiguration.Initialize();
        Toasts.Register(Path.Combine(AppContext.BaseDirectory, "app.png"));
        Application.SetColorMode(SystemColorMode.Dark);
        var settings = AppSettings.Load();
        var startHidden = args.Contains("--tray", StringComparer.OrdinalIgnoreCase);
        using var form = new MainForm(settings, startHidden);

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var testEvent = new EventWaitHandle(false, EventResetMode.AutoReset, TestEventName);
        using var quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName);
        var listener = new Thread(() =>
        {
            while (true)
            {
                var which = WaitHandle.WaitAny([showEvent, testEvent, quitEvent]);
                if (form.IsDisposed) return;
                try
                {
                    if (which == 0) form.BeginInvoke(() => form.BringToFront_());
                    else if (which == 1) form.BeginInvoke(() => form.SendTestNotification());
                    else { form.BeginInvoke(() => form.QuitApp()); return; }
                }
                catch (InvalidOperationException) { return; }
            }
        }) { IsBackground = true, Name = "single-instance" };
        listener.Start();

        Application.Run(form);
    }
}
