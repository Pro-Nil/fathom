using System.Security;
using Microsoft.Win32;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

namespace PentestHarness.Desktop;

/// <summary>
/// Real Windows toast notifications for an unpackaged app. The app registers
/// its AppUserModelID (name + icon) under HKCU so toasts show as
/// "Pentest Harness" and stay in the notification centre, and registers the
/// <c>pentestharness:</c> protocol so clicking a toast brings the window back.
/// Toasts are silent: the app plays its own sound.
/// </summary>
internal static class Toasts
{
    public const string AppId = "PentestHarness.Desktop";
    public const string Protocol = "pentestharness";

    /// <summary>Register the app identity and the click-to-open protocol for the current user.</summary>
    public static void Register(string iconPath)
    {
        SetCurrentProcessExplicitAppUserModelID(AppId);
        var exe = Environment.ProcessPath ?? "";
        using (var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\AppUserModelId\{AppId}"))
        {
            key.SetValue("DisplayName", "Pentest Harness");
            key.SetValue("IconUri", iconPath);
            key.SetValue("IconBackgroundColor", "FF0B0B0D");
        }
        using (var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Protocol}"))
        {
            key.SetValue("", "URL:Pentest Harness");
            key.SetValue("URL Protocol", "");
            using var icon = key.CreateSubKey("DefaultIcon");
            icon.SetValue("", $"\"{exe}\",0");
            using var command = key.CreateSubKey(@"shell\open\command");
            command.SetValue("", $"\"{exe}\" \"%1\"");
        }
    }

    /// <summary>
    /// Show a silent toast; clicking it (or Open) reopens the app window.
    /// <paramref name="urgent"/> toasts (the agent is waiting for the user) use
    /// Windows 11's urgent scenario, which breaks through Do Not Disturb unless
    /// the user turns that off for this app in Settings → Notifications.
    /// </summary>
    public static void Show(string title, string body, string tag, bool urgent)
    {
        var scenario = urgent ? " scenario=\"urgent\"" : "";
        var xml = $"""
            <toast activationType="protocol" launch="{Protocol}:open" duration="long"{scenario}>
              <visual>
                <binding template="ToastGeneric">
                  <text>{Escape(title)}</text>
                  <text>{Escape(body)}</text>
                </binding>
              </visual>
              <actions>
                <action content="Open" activationType="protocol" arguments="{Protocol}:open"/>
              </actions>
              <audio silent="true"/>
            </toast>
            """;
        var document = new XmlDocument();
        document.LoadXml(xml);
        var toast = new ToastNotification(document) { Tag = Clip(tag, 64), Group = "input" };
        ToastNotificationManager.CreateToastNotifier(AppId).Show(toast);
    }

    private static string Escape(string text) => SecurityElement.Escape(text) ?? "";

    private static string Clip(string text, int max) => text.Length <= max ? text : text[..max];

    [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
