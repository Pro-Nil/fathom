using System.Text.Json;
using System.Text.Json.Serialization;

namespace PentestHarness.Desktop;

/// <summary>
/// Settings kept in %LOCALAPPDATA%\PentestHarness\settings.json. Created with
/// defaults on first run; edit the file to point at another checkout or port.
/// </summary>
internal sealed class AppSettings
{
    /// <summary>Harness checkout that contains apps/cli.</summary>
    public string Repo { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "pentest-harness");

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

    [JsonIgnore]
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PentestHarness");

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
