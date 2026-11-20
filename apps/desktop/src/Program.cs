using System.IO.Pipes;
using Avalonia;
using Avalonia.Threading;

namespace Fathom.Desktop;

internal static class Program
{
    /// <summary>
    /// Per-user pipe the running app listens on (a Unix socket on Linux). A
    /// second launch sends it one command and exits: "show" (Start menu,
    /// launcher, toast click), "test" (`--test-notification`), "quit"
    /// (`--quit`) or "quit-keep" (`--quit --keep-harness`, used when updating
    /// the app: the harness keeps running and the next launch takes it back).
    /// </summary>
    private static readonly string PipeName = $"Fathom.Desktop.{Environment.UserName}"
        + (Environment.GetEnvironmentVariable("FATHOM_APP_DIR") is { Length: > 0 } dir ? "." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(dir)))[..8] : "");

    [STAThread]
    private static int Main(string[] args)
    {
        var has = (string flag) => args.Contains(flag, StringComparer.OrdinalIgnoreCase);
        var command = has("--test-notification") ? "test"
            : has("--quit") && has("--keep-harness") ? "quit-keep"
            : has("--quit") ? "quit"
            : "show";
        if (TrySend(command)) return 0;
        // Nothing running: --quit has nothing to do.
        if (command.StartsWith("quit", StringComparison.Ordinal)) return 0;

        Platform.Register();
        App.StartHidden = has("--tray");
        using var cancel = new CancellationTokenSource();
        _ = Task.Run(() => ListenAsync(cancel.Token));
        var code = BuildAvaloniaApp().StartWithClassicDesktopLifetime(args, Avalonia.Controls.ShutdownMode.OnExplicitShutdown);
        cancel.Cancel();
        return code;
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .With(new X11PlatformOptions { WmClass = "Fathom" })
            .LogToTrace();

    private static bool TrySend(string command)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(300);
            using var writer = new StreamWriter(client);
            writer.WriteLine(command);
            writer.Flush();
            return true;
        }
        catch (Exception ex) when (ex is TimeoutException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static async Task ListenAsync(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancel);
                using var reader = new StreamReader(server);
                var command = (await reader.ReadLineAsync(cancel))?.Trim();
                Dispatcher.UIThread.Post(() =>
                {
                    var window = App.Window;
                    if (window is null) return;
                    switch (command)
                    {
                        case "test": window.SendTestNotification(); break;
                        case "quit": window.Quit(); break;
                        case "quit-keep": window.Quit(keepHarness: true); break;
                        default: window.ShowFromTray(); break;
                    }
                });
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
                await Task.Delay(200, CancellationToken.None);
            }
        }
    }
}
