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
/// console window, inside a Job Object, so quitting (or a crash) ends the whole
/// process tree.
/// </summary>
internal sealed class HarnessServer : IDisposable
{
    private readonly AppSettings settings;
    private Process? process;
    private IntPtr job;
    private StreamWriter? log;

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
            status("Connected to the running harness");
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
        log = new StreamWriter(new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        log.WriteLine($"── {DateTime.Now:yyyy-MM-dd HH:mm:ss} starting harness ({node})");

        var info = new ProcessStartInfo(node)
        {
            WorkingDirectory = settings.Repo,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
        };
        foreach (var arg in new[] { "--import", "tsx/esm", "apps/cli/src/bin.ts", "web", "--no-open" }) info.ArgumentList.Add(arg);
        info.Environment["FORCE_COLOR"] = "0";

        job = CreateKillOnCloseJob();
        var started = new Process { StartInfo = info, EnableRaisingEvents = true };
        started.OutputDataReceived += (_, e) => { if (e.Data is not null) WriteLog(e.Data); };
        started.ErrorDataReceived += (_, e) => { if (e.Data is not null) WriteLog(e.Data); };
        started.Exited += (_, _) =>
        {
            int code;
            try { code = started.ExitCode; } catch (InvalidOperationException) { code = -1; }
            WriteLog($"── harness exited with code {code}");
            if (ReferenceEquals(process, started)) { process = null; Exited?.Invoke(code); }
        };
        if (!started.Start()) throw new InvalidOperationException("The harness process did not start.");
        if (job != IntPtr.Zero && !AssignProcessToJobObject(job, started.Handle))
        {
            WriteLog($"warning: could not attach the harness to a job object ({Marshal.GetLastWin32Error()})");
        }
        process = started;
        started.BeginOutputReadLine();
        started.BeginErrorReadLine();

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
        log?.Dispose();
        log = null;
    }

    public void Dispose() => Stop();

    private void WriteLog(string line)
    {
        try { log?.WriteLine(line); } catch (ObjectDisposedException) { }
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

    private static string? ResolveNode(string configured)
    {
        if (Path.IsPathRooted(configured)) return File.Exists(configured) ? configured : null;
        var names = configured.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? new[] { configured } : new[] { configured + ".exe", configured };
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        // A shortcut launch inherits Explorer's environment, which can predate a
        // PATH change; read the persisted user and machine PATH as well.
        path += ";" + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User);
        path += ";" + Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine);
        foreach (var dir in path.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
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

    // ── Job object ──────────────────────────────────────────────────────

    private static IntPtr CreateKillOnCloseJob()
    {
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
