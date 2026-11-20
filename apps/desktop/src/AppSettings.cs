using System.Text.Json;
using System.Text.Json.Serialization;

namespace Fathom.Desktop;

/// <summary>
/// Settings kept in settings.json in the app data folder. Created with
/// defaults on first run; edit the file to point at another checkout or port.
/// </summary>
internal sealed class AppSettings
{
    /// <summary>Harness checkout that contains apps/cli: ~/fathom, or a checkout still in its pre-rename folder.</summary>
    public string Repo { get; set; } = DefaultRepo();

    private static string DefaultRepo()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var current = Path.Combine(home, "fathom");
        var legacy = Path.Combine(home, LegacyName.Checkout);
        return !Directory.Exists(current) && Directory.Exists(legacy) ? legacy : current;
    }

    /// <summary>Port the web UI listens on.</summary>
    public int Port { get; set; } = 2323;

    /// <summary>Node executable; a bare name is looked up on PATH.</summary>
    public string Node { get; set; } = "node";

    /// <summary>Seconds to wait for the server before showing an error.</summary>
    public int StartupTimeoutSeconds { get; set; } = 120;

    /// <summary>Show a notification even while the window is focused.</summary>
    public bool NotifyWhenFocused { get; set; }

    /// <summary>Set once the "still running in the tray" hint has been shown.</summary>
    public bool TrayHintShown { get; set; }

    /// <summary>Last window bounds (x, y, width, height), restored on launch.</summary>
    public int[]? Bounds { get; set; }

    /// <summary>Whether the window was maximized when last hidden.</summary>
    public bool Maximized { get; set; }

    /// <summary>
    /// The checkout commit the last in-app update built. When the checkout's
    /// HEAD moves past it (a pull, or a commit made in the checkout), the app
    /// offers Update so the harness is rebuilt and restarted on the new code.
    /// </summary>
    public string? LastBuiltCommit { get; set; }

    /// <summary>
    /// App data folder: %LOCALAPPDATA%\Fathom on Windows,
    /// ~/.local/share/Fathom on Linux. FATHOM_APP_DIR
    /// overrides it (a second, isolated app instance for testing).
    /// </summary>
    [JsonIgnore]
    public static string Folder { get; } = Environment.GetEnvironmentVariable("FATHOM_APP_DIR") is { Length: > 0 } dir
        ? dir
        : MigratedFolder(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Fathom"));

    /// <summary>
    /// Move the pre-rename app folder (settings, logs, the in-app browser
    /// profile) to the Fathom one the first time. If it cannot move (a file is
    /// still open), keep using the old folder; the move is retried next start.
    /// </summary>
    private static string MigratedFolder(string target)
    {
        var legacy = Path.Combine(Path.GetDirectoryName(target)!, LegacyName.AppFolder);
        if (Directory.Exists(target) || !Directory.Exists(legacy)) return target;
        try
        {
            Directory.Move(legacy, target);
            return target;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return legacy;
        }
    }

    [JsonIgnore]
    private static string FilePath => Path.Combine(Folder, "settings.json");

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static AppSettings Load()
    {
        Directory.CreateDirectory(Folder);
        try
        {
            if (File.Exists(FilePath))
            {
                var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), Json);
                if (loaded is not null) return loaded;
            }
        }
        catch (JsonException)
        {
            // A hand-edit broke the file: keep a copy and start from defaults.
            File.Copy(FilePath, FilePath + ".broken", overwrite: true);
        }
        var settings = new AppSettings();
        settings.Save();
        return settings;
    }

    public void Save()
    {
        Directory.CreateDirectory(Folder);
        var temp = FilePath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, Json));
        File.Move(temp, FilePath, overwrite: true);
    }
}
