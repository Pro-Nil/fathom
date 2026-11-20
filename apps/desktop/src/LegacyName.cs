namespace Fathom.Desktop;

/// <summary>
/// Names the app used before the project was renamed to Fathom. They are read
/// once to carry an existing install forward (its data folder, checkout,
/// start-at-login entry and Linux menu entries) and never written again.
/// </summary>
internal static class LegacyName
{
    /// <summary>The old app data folder under %LOCALAPPDATA% / ~/.local/share.</summary>
    public const string AppFolder = "Pentest" + "Harness";

    /// <summary>The old default checkout folder under the user's home.</summary>
    public const string Checkout = "pentest" + "-harness";

    /// <summary>The old Windows start-at-login value and Linux .desktop file stem.</summary>
    public const string RunValue = AppFolder;

    /// <summary>The old Linux launcher and autostart file name.</summary>
    public const string DesktopFile = Checkout + ".desktop";
}
