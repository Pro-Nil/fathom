using System.ComponentModel;
using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace PentestHarness.Desktop;

/// <summary>
/// Owns the harness web server process. If something already listens on the
/// port (for example a server started from a terminal) the app attaches to it
/// and leaves it alone on quit. Otherwise it starts
/// <c>node --import tsx/esm apps/cli/src/bin.ts web --no-open</c> with no
/// console window. On Windows it runs inside a Job Object, so quitting (or a
/// crash) ends the whole process tree; on Linux quitting kills the tree.
/// </summary>
internal sealed class HarnessServer : IDisposable
{
    private readonly AppSettings settings;
    private Process? process;
    private IntPtr job;

    public HarnessServer(AppSettings settings) => this.settings = settings;

    /// <summary>True when this app started the server (and will stop it on quit).</summary>
    public bool Owned => process is not null;

    /// <summary>The web UI address.</summary>
    public Uri Url => new($"http://127.0.0.1:{settings.Port}/");

    public static string LogPath => Path.Combine(AppSettings.Folder, "logs", "harness.log");

    /// <summary>Raised (on a worker thread) when an owned server exits unexpectedly.</summary>
    public event Action<int>? Exited;

    public bool IsListening()
    {
        try
        {
            using var client = new TcpClient();
            var connect = client.ConnectAsync("127.0.0.1", settings.Port);
            return connect.Wait(400) && client.Connected;
        }
        catch (Exception ex) when (ex is SocketException or AggregateException)
        {
            return false;
        }
    }

    /// <summary>Start the server unless one is already listening, then wait until it accepts connections.</summary>
    public async Task StartAsync(Action<string> status, CancellationToken cancel)
    {
        if (IsListening())
        {
            status(TryAdopt() ? "Reconnected to the harness" : "Connected to the running harness");
            return;
        }
        var cli = Path.Combine(settings.Repo, "apps", "cli", "src", "bin.ts");
        if (!File.Exists(cli))
        {
            throw new InvalidOperationException($"Could not find the harness at {settings.Repo}.\nSet \"repo\" in {Path.Combine(AppSettings.Folder, "settings.json")}.");
        }
        var node = ResolveNode(settings.Node)
            ?? throw new InvalidOperationException("Node.js was not found on PATH. Install Node.js or set \"node\" in settings.json.");

        Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
        RotateLog();
        WriteLog($"── {DateTime.Now:yyyy-MM-dd HH:mm:ss} starting harness ({node})");

        // The shell appends node's output straight to the log file. Nothing
        // pipes through this app, so the harness can outlive an app update
        // (Detach) without writing into a closed pipe.
        ProcessStartInfo info;
        if (OperatingSystem.IsWindows())
        {
            var command = $"\"\"{node}\" --import tsx/esm apps/cli/src/bin.ts web --no-open >> \"{LogPath}\" 2>&1\"";
            info = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe")
            {
                Arguments = "/d /s /c " + command,
            };
        }
        else
        {
            // exec: the shell becomes node, so the tracked process is the server itself.
            info = new ProcessStartInfo("/bin/sh");
            info.ArgumentList.Add("-c");
            info.ArgumentList.Add("exec \"$0\" --import tsx/esm apps/cli/src/bin.ts web --no-open >> \"$1\" 2>&1");
            info.ArgumentList.Add(node);
            info.ArgumentList.Add(LogPath);
        }
        info.WorkingDirectory = settings.Repo;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.Environment["FORCE_COLOR"] = "0";

        job = CreateKillOnCloseJob();
        var started = new Process { StartInfo = info, EnableRaisingEvents = true };
        WatchExit(started);
        if (!started.Start()) throw new InvalidOperationException("The harness process did not start.");
        if (job != IntPtr.Zero && !AssignProcessToJobObject(job, started.Handle))
        {
            WriteLog($"warning: could not attach the harness to a job object ({Marshal.GetLastWin32Error()})");
        }
        process = started;

        status("Starting the harness…");
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(10, settings.StartupTimeoutSeconds));
        while (!IsListening())
        {
            cancel.ThrowIfCancellationRequested();
            if (process is null || started.HasExited)
            {
                throw new InvalidOperationException($"The harness stopped while starting. See the log:\n{LogPath}");
            }
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException($"The harness did not start within {settings.StartupTimeoutSeconds}s. See the log:\n{LogPath}");
            }
            await Task.Delay(300, cancel);
        }
        RememberOwnedServer();
    }

    // ── ownership across app restarts ───────────────────────────────────

    private static string PidFile => Path.Combine(AppSettings.Folder, "harness.pid");

    /// <summary>Record the listening node process so a relaunched app can take it back.</summary>
    private void RememberOwnedServer()
    {
        foreach (var pid in ListeningPids(settings.Port))
        {
            try
            {
                using var node = Process.GetProcessById(pid);
                File.WriteAllText(PidFile, $"{pid} {node.StartTime.ToUniversalTime().Ticks}");
                return;
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or Win32Exception) { }
        }
    }

    /// <summary>
    /// If the server on the port is the one this app started before (same pid
    /// and start time as recorded), own it again: put it back in a kill-on-quit
    /// job so Quit stops it. A server started any other way is left alone.
    /// </summary>
    private bool TryAdopt()
    {
        try
        {
            if (!File.Exists(PidFile)) return false;
            var parts = File.ReadAllText(PidFile).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 2 || !int.TryParse(parts[0], out var pid) || !long.TryParse(parts[1], out var ticks)) return false;
            if (!ListeningPids(settings.Port).Contains(pid)) return false;
            var node = Process.GetProcessById(pid);
            if (node.StartTime.ToUniversalTime().Ticks != ticks)
            {
                node.Dispose();
                return false;
            }
            node.EnableRaisingEvents = true;
            WatchExit(node);
            job = CreateKillOnCloseJob();
            if (job != IntPtr.Zero) AssignProcessToJobObject(job, node.Handle);
            process = node;
            WriteLog($"── {DateTime.Now:yyyy-MM-dd HH:mm:ss} desktop app reconnected to harness pid {pid}");
            return true;
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or InvalidOperationException or Win32Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Let the server keep running after this app exits (used when the app
    /// itself is being updated). The next launch takes it back with TryAdopt.
    /// </summary>
    public void Detach()
    {
        if (job != IntPtr.Zero)
        {
            // Clear KILL_ON_JOB_CLOSE before closing the handle.
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            var ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                SetInformationJobObject(job, 9, ptr, (uint)size);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
            CloseHandle(job);
            job = IntPtr.Zero;
        }
        process?.Dispose();
        process = null;
        WriteLog("── desktop app closed; harness left running");
    }

    private void WatchExit(Process watched)
    {
        watched.Exited += (_, _) =>
        {
            int code;
            try { code = watched.ExitCode; } catch (InvalidOperationException) { code = -1; }
            WriteLog($"── harness exited with code {code}");
            if (ReferenceEquals(process, watched))
            {
                process = null;
                Exited?.Invoke(code);
            }
        };
    }

    /// <summary>Processes listening on the TCP port (netstat on Windows; ss, then lsof, on Linux).</summary>
    internal static List<int> ListeningPids(int port)
    {
        var pids = new List<int>();
        if (!OperatingSystem.IsWindows())
        {
            var ss = Capture("ss", ["-Hltnp", $"sport = :{port}"]);
            foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(ss ?? "", @"pid=(\d+)"))
            {
                if (int.TryParse(m.Groups[1].Value, out var pid) && !pids.Contains(pid)) pids.Add(pid);
            }
            if (pids.Count == 0)
            {
                foreach (var line in (Capture("lsof", ["-t", $"-iTCP:{port}", "-sTCP:LISTEN"]) ?? "").Split('\n'))
                {
                    if (int.TryParse(line.Trim(), out var pid) && !pids.Contains(pid)) pids.Add(pid);
                }
            }
            return pids;
        }
        try
        {
            var info = new ProcessStartInfo("netstat", "-ano -p TCP") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var netstat = Process.Start(info);
            if (netstat is null) return pids;
            foreach (var line in netstat.StandardOutput.ReadToEnd().Split('\n'))
            {
                var cols = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (cols.Length >= 5 && cols[3] == "LISTENING" && cols[1].EndsWith($":{port}", StringComparison.Ordinal) && int.TryParse(cols[4], out var pid)) pids.Add(pid);
            }
        }
        catch (Win32Exception) { }
        return pids;
    }


    private static string? Capture(string file, string[] args)
    {
        try
        {
            var info = new ProcessStartInfo(file) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            foreach (var arg in args) info.ArgumentList.Add(arg);
            using var process = Process.Start(info);
            if (process is null) return null;
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);
            return output;
        }
        catch (Win32Exception)
        {
            return null;
        }
    }

    /// <summary>Stop the server if this app started it. Attached servers are left running.</summary>
    public void Stop()
    {
        var running = process;
        process = null;
        if (job != IntPtr.Zero)
        {
            // KILL_ON_JOB_CLOSE ends node and every child it spawned.
            CloseHandle(job);
            job = IntPtr.Zero;
        }
        if (running is not null)
        {
            try
            {
                if (!running.HasExited) running.Kill(entireProcessTree: true);
                running.WaitForExit(5000);
            }
            catch (Exception ex) when (ex is InvalidOperationException or Win32Exception) { }
            running.Dispose();
            WriteLog("── harness stopped by the desktop app");
        }
        try { File.Delete(PidFile); } catch (IOException) { }
    }

    public void Dispose() => Stop();

    /// <summary>The app's own events (start, stop, detach, reconnect); harness.log is the server's output.</summary>
    public static string AppLogPath => Path.Combine(AppSettings.Folder, "logs", "desktop.log");

    /// <summary>Append a line to the app's own log (desktop.log).</summary>
    public static void AppLog(string line) => WriteLog($"{DateTime.Now:HH:mm:ss} {line}");

    private static void WriteLog(string line)
    {
        // cmd holds harness.log open while the server runs, so the app logs
        // its own events to a separate file.
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AppLogPath)!);
            using var stream = new FileStream(AppLogPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            using var writer = new StreamWriter(stream);
            writer.WriteLine(line);
        }
        catch (IOException) { }
    }

    private static void RotateLog()
    {
        try
        {
            var file = new FileInfo(LogPath);
            if (file.Exists && file.Length > 5 * 1024 * 1024) File.Move(LogPath, LogPath + ".1", overwrite: true);
        }
        catch (IOException) { }
    }

    internal static string? ResolveNode(string configured)
    {
        if (Path.IsPathRooted(configured)) return File.Exists(configured) ? configured : null;
        var windows = OperatingSystem.IsWindows();
        var names = !windows || configured.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? new[] { configured } : new[] { configured + ".exe", configured };
        foreach (var dir in ToolSearchPath().Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            foreach (var name in names)
            {
                try
                {
                    var candidate = Path.Combine(Environment.ExpandEnvironmentVariables(dir), name);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { }
            }
        }
        return null;
    }

    /// <summary>
    /// PATH for finding node, git and pnpm: the app's own PATH plus what a
    /// shortcut or desktop launcher tends to miss (the persisted user and
    /// machine PATH on Windows; ~/.local/bin, volta and nvm on Linux).
    /// </summary>
    internal static string ToolSearchPath()
    {
        var windows = OperatingSystem.IsWindows();
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        if (windows)
        {
            // A shortcut launch inherits Explorer's environment, which can predate a
            // PATH change; read the persisted user and machine PATH as well.
            path += ";" + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User);
            path += ";" + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine);
        }
        else
        {
            // A desktop launcher gets the session's PATH, which often lacks the
            // directories version managers and user installs add in shell rc files.
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            path += $":{home}/.local/bin:{home}/.volta/bin:/usr/local/bin:/usr/bin";
            var nvm = Path.Combine(home, ".nvm", "versions", "node");
            if (Directory.Exists(nvm))
            {
                foreach (var version in Directory.GetDirectories(nvm).OrderDescending()) path += $":{version}/bin";
            }
            var pnpmHome = Path.Combine(home, ".local", "share", "pnpm");
            if (Directory.Exists(pnpmHome)) path += $":{pnpmHome}";
        }
        return path;
    }

    // ── Job object ──────────────────────────────────────────────────────

    private static IntPtr CreateKillOnCloseJob()
    {
        if (!OperatingSystem.IsWindows()) return IntPtr.Zero;
        var handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) return IntPtr.Zero;
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(handle, 9 /* JobObjectExtendedLimitInformation */, ptr, (uint)size))
            {
                CloseHandle(handle);
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
        return handle;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
