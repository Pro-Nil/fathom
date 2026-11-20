using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Fathom.Desktop;

/// <summary>
/// The in-app update: everything the update guide asks you to type, behind
/// one button. <see cref="CheckAsync"/> looks for new commits on the
/// checkout's upstream branch (and for local commits not built yet);
/// <see cref="RunAsync"/> pulls them, installs dependencies and builds, and
/// reports whether the desktop app itself changed. The caller restarts the
/// harness afterwards, so the running harness keeps serving the UI for the
/// whole download and build and only goes down for the restart.
///
/// Output of every step goes to logs/update.log in the app folder.
/// </summary>
internal sealed class Updater
{
    private readonly AppSettings settings;
    private int running;

    public Updater(AppSettings settings) => this.settings = settings;

    public static string LogPath => Path.Combine(AppSettings.Folder, "logs", "update.log");

    /// <summary>What an update would do right now.</summary>
    /// <param name="Behind">Commits on the upstream branch that the checkout does not have.</param>
    /// <param name="Unbuilt">The checkout has code the running build does not (new local commits, or no build recorded yet).</param>
    /// <param name="Upstream">The upstream branch it pulls from (for example <c>origin/main</c>), or null when the branch tracks none.</param>
    /// <param name="Problem">Why it cannot pull (local commits diverged, no git), or null.</param>
    public sealed record Status(int Behind, bool Unbuilt, string? Upstream, string? Problem)
    {
        public bool Available => Behind > 0 || Unbuilt;
    }

    /// <summary>The result of a finished update.</summary>
    /// <param name="DesktopChanged">Files under apps/desktop changed, so the app itself should be reinstalled.</param>
    public sealed record Outcome(string Commit, int Pulled, bool DesktopChanged);

    public bool IsRunning => Volatile.Read(ref running) == 1;

    /// <summary>
    /// Fetch the upstream branch and compare. Never changes the checkout.
    /// </summary>
    /// <param name="fetch">Contact the remote; false only compares against what was fetched before.</param>
    public async Task<Status> CheckAsync(bool fetch, CancellationToken cancel)
    {
        var head = (await GitAsync("rev-parse HEAD", cancel)).Output.Trim();
        if (head.Length == 0) return new Status(0, false, null, "The checkout is not a git repository, or git is not installed.");
        var unbuilt = settings.LastBuiltCommit != head;
        var upstream = await GitAsync("rev-parse --abbrev-ref --symbolic-full-name @{u}", cancel);
        if (upstream.Code != 0) return new Status(0, unbuilt, null, null);
        var name = upstream.Output.Trim();
        if (fetch)
        {
            var remote = name.Split('/')[0];
            var fetched = await GitAsync($"fetch --quiet {remote}", cancel);
            if (fetched.Code != 0) return new Status(0, unbuilt, name, $"Could not reach {remote}: {LastLine(fetched.Output)}");
        }
        var counts = (await GitAsync("rev-list --left-right --count HEAD...@{u}", cancel)).Output.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var ahead = counts.Length == 2 && int.TryParse(counts[0], out var a) ? a : 0;
        var behind = counts.Length == 2 && int.TryParse(counts[1], out var b) ? b : 0;
        var problem = ahead > 0 && behind > 0
            ? $"The checkout has {ahead} local commit{(ahead == 1 ? "" : "s")} that {name} does not, so it cannot fast-forward. Push or rebase them first."
            : null;
        return new Status(problem is null ? behind : 0, unbuilt, name, problem);
    }

    /// <summary>
    /// Pull (fast-forward only, keeping local edits), install and build.
    /// Throws with the failing step's last output lines when a step fails.
    /// </summary>
    /// <param name="progress">Short step descriptions for the UI.</param>
    public async Task<Outcome> RunAsync(Action<string> progress, CancellationToken cancel)
    {
        if (Interlocked.Exchange(ref running, 1) == 1) throw new InvalidOperationException("An update is already running.");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            Log($"\n── {DateTime.Now:yyyy-MM-dd HH:mm:ss} update in {settings.Repo}");
            progress("Checking for updates…");
            var status = await CheckAsync(fetch: true, cancel);
            if (status.Problem is not null && status.Upstream is not null) throw new InvalidOperationException(status.Problem);
            var before = (await GitAsync("rev-parse HEAD", cancel)).Output.Trim();

            if (status.Behind > 0)
            {
                progress($"Downloading {status.Behind} update{(status.Behind == 1 ? "" : "s")}…");
                // --autostash keeps local edits (for example a lockfile an older
                // install rewrote) instead of refusing to pull.
                await Step("git pull --ff-only --autostash", cancel);
            }
            var after = (await GitAsync("rev-parse HEAD", cancel)).Output.Trim();

            progress("Installing dependencies…");
            // No terminal to answer prompts: never ask to purge node_modules.
            // Install from the committed lockfile first; fall back to a regular
            // install when the lockfile is behind package.json.
            var frozen = await Shell("pnpm install --frozen-lockfile --config.confirmModulesPurge=false", cancel);
            if (frozen.Code != 0) await Step("pnpm install --config.confirmModulesPurge=false", cancel);

            progress("Building…");
            await Step("pnpm build", cancel);

            settings.LastBuiltCommit = after;
            settings.Save();
            var desktopChanged = before != after
                && (await GitAsync($"diff --name-only {before} {after} -- apps/desktop", cancel)).Output.Trim().Length > 0;
            Log($"updated {before[..Math.Min(8, before.Length)]} → {after[..Math.Min(8, after.Length)]}; app changed: {desktopChanged}");
            return new Outcome(after, status.Behind, desktopChanged);
        }
        finally
        {
            Volatile.Write(ref running, 0);
        }
    }

    /// <summary>
    /// Publish the desktop app from the checkout into a staging folder, for
    /// <see cref="SwapAndRelaunch"/>. Returns the folder, or null with the
    /// reason when the .NET SDK is missing or the publish fails.
    /// </summary>
    public async Task<(string? Folder, string? Problem)> PublishAppAsync(CancellationToken cancel)
    {
        var staged = Path.Combine(AppSettings.Folder, "staged");
        try { if (Directory.Exists(staged)) Directory.Delete(staged, recursive: true); }
        catch (IOException) { }
        var arch = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "arm64" : "x64";
        var target = OperatingSystem.IsWindows()
            ? $"-f net10.0-windows10.0.19041.0 -r win-{arch}"
            : $"-f net10.0 -r linux-{arch}";
        var result = await Shell($"dotnet publish apps/desktop {target} -c Release --self-contained false -o \"{staged}\"", cancel);
        if (result.Code != 0) return (null, $"Could not rebuild the desktop app ({LastLine(result.Output)}). The harness is updated; reinstall the app from the update guide when convenient.");
        return (staged, null);
    }

    /// <summary>
    /// Start a detached helper that waits for this app to exit, copies the
    /// staged build over the installed one and opens the app again. The caller
    /// then quits with the harness kept running, so the new app reattaches.
    /// </summary>
    public static void SwapAndRelaunch(string staged)
    {
        var install = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var exe = Environment.ProcessPath ?? Path.Combine(install, OperatingSystem.IsWindows() ? "Fathom.exe" : "Fathom");
        var pid = Environment.ProcessId;
        ProcessStartInfo info;
        if (OperatingSystem.IsWindows())
        {
            static string Quote(string value) => "'" + value.Replace("'", "''") + "'";
            var script = $"Wait-Process -Id {pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; " +
                         $"Copy-Item -Path (Join-Path {Quote(staged)} '*') -Destination {Quote(install)} -Recurse -Force; " +
                         $"Start-Process -FilePath {Quote(exe)}";
            info = new ProcessStartInfo("powershell.exe");
            foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script }) info.ArgumentList.Add(arg);
        }
        else
        {
            info = new ProcessStartInfo("/bin/sh");
            info.ArgumentList.Add("-c");
            info.ArgumentList.Add("while kill -0 \"$0\" 2>/dev/null; do sleep 0.3; done; cp -r \"$1\"/. \"$2\"/ && exec setsid \"$3\" >/dev/null 2>&1");
            info.ArgumentList.Add(pid.ToString(System.Globalization.CultureInfo.InvariantCulture));
            info.ArgumentList.Add(staged);
            info.ArgumentList.Add(install);
            info.ArgumentList.Add(exe);
        }
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        Log($"swapping the app in {install} after pid {pid} exits");
        Process.Start(info);
    }

    // ── running commands ───────────────────────────────────────────────

    private async Task Step(string command, CancellationToken cancel)
    {
        var result = await Shell(command, cancel);
        if (result.Code != 0)
        {
            throw new InvalidOperationException($"`{command}` failed:\n{Tail(result.Output, 12)}\n\nFull output: {LogPath}");
        }
    }

    private Task<(int Code, string Output)> GitAsync(string args, CancellationToken cancel) => Shell("git " + args, cancel, log: false);

    /// <summary>Run a command line in the checkout through the platform shell (so pnpm.cmd and PATH lookups work).</summary>
    private async Task<(int Code, string Output)> Shell(string command, CancellationToken cancel, bool log = true)
    {
        ProcessStartInfo info;
        if (OperatingSystem.IsWindows())
        {
            info = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe") { Arguments = $"/d /s /c \"{command}\"" };
        }
        else
        {
            info = new ProcessStartInfo("/bin/sh");
            info.ArgumentList.Add("-c");
            info.ArgumentList.Add(command);
        }
        info.WorkingDirectory = settings.Repo;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.RedirectStandardInput = true;
        var path = HarnessServer.ToolSearchPath();
        if (HarnessServer.ResolveNode(settings.Node) is { } node) path = Path.GetDirectoryName(node) + Path.PathSeparator + path;
        info.Environment["PATH"] = path;
        info.Environment["FORCE_COLOR"] = "0";
        info.Environment["GIT_TERMINAL_PROMPT"] = "0";

        if (log) Log($"$ {command}");
        var output = new StringBuilder();
        using var process = new Process { StartInfo = info };
        void Capture(string? line)
        {
            if (line is null) return;
            lock (output) output.AppendLine(line);
            if (log) Log(line);
        }
        process.OutputDataReceived += (_, e) => Capture(e.Data);
        process.ErrorDataReceived += (_, e) => Capture(e.Data);
        try
        {
            process.Start();
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            return (-1, ex.Message);
        }
        process.StandardInput.Close();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        try
        {
            await process.WaitForExitAsync(cancel);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
        if (log) Log($"(exit {process.ExitCode})");
        lock (output) return (process.ExitCode, output.ToString());
    }

    private static string Tail(string text, int lines)
    {
        var all = text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join('\n', all.Skip(Math.Max(0, all.Length - lines)));
    }

    private static string LastLine(string text) => Tail(text, 1);

    private static readonly object LogLock = new();

    private static void Log(string line)
    {
        try
        {
            lock (LogLock)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath, line + Environment.NewLine);
            }
        }
        catch (IOException) { }
    }
}
