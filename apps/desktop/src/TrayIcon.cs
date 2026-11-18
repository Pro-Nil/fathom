using System.Runtime.InteropServices;

namespace PentestHarness.Desktop;

/// <summary>
/// Notification-area icon over Shell_NotifyIcon directly (instead of
/// WinForms' NotifyIcon) so notifications can be raised with NIIF_NOSOUND:
/// Windows stays silent and the app plays its own sound. On Windows 10/11 the
/// balloon is shown as a regular toast and kept in the notification centre.
/// </summary>
internal sealed class TrayIcon : NativeWindow, IDisposable
{
    private const int WM_APP_TRAY = 0x8000 + 1;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_LBUTTONDBLCLK = 0x0203;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_CONTEXTMENU = 0x007B;
    private const int NIN_SELECT = 0x0400;
    private const int NIN_KEYSELECT = 0x0401;
    private const int NIN_BALLOONUSERCLICK = 0x0405;

    private const uint NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4;
    private const uint NIF_MESSAGE = 0x1, NIF_ICON = 0x2, NIF_TIP = 0x4, NIF_INFO = 0x10, NIF_SHOWTIP = 0x80;
    private const uint NIIF_USER = 0x4, NIIF_NOSOUND = 0x10, NIIF_LARGE_ICON = 0x20;

    private readonly uint taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    private readonly Icon icon;
    private readonly Icon largeIcon;
    private string tip;
    private bool added;

    /// <summary>Left click or keyboard select on the icon.</summary>
    public event Action? Activated;

    /// <summary>The user clicked the most recent notification.</summary>
    public event Action? NotificationClicked;

    /// <summary>Right click on the icon; the handler shows the menu.</summary>
    public event Action? MenuRequested;

    public TrayIcon(Icon icon, Icon largeIcon, string tip)
    {
        this.icon = icon;
        this.largeIcon = largeIcon;
        this.tip = tip;
        CreateHandle(new CreateParams { Caption = "PentestHarnessTray" });
        Add();
    }

    public void SetTip(string text)
    {
        tip = text;
        var data = Data(NIF_TIP | NIF_SHOWTIP);
        Shell_NotifyIcon(NIM_MODIFY, ref data);
    }

    /// <summary>Show a silent toast-style notification from the tray icon.</summary>
    public void Notify(string title, string body)
    {
        var data = Data(NIF_INFO);
        data.szInfoTitle = Clip(title, 63);
        data.szInfo = Clip(body.Length == 0 ? " " : body, 255);
        data.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON | NIIF_NOSOUND;
        data.hBalloonIcon = largeIcon.Handle;
        Shell_NotifyIcon(NIM_MODIFY, ref data);
    }

    private void Add()
    {
        var data = Data(NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP);
        added = Shell_NotifyIcon(NIM_ADD, ref data);
        data.uVersion = 4; // NOTIFYICON_VERSION_4
        Shell_NotifyIcon(NIM_SETVERSION, ref data);
    }

    private NOTIFYICONDATA Data(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
        hWnd = Handle,
        uID = 1,
        uFlags = flags,
        uCallbackMessage = WM_APP_TRAY,
        hIcon = icon.Handle,
        szTip = Clip(tip, 127),
        szInfo = "",
        szInfoTitle = "",
    };

    private static string Clip(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_APP_TRAY)
        {
            switch ((int)(m.LParam.ToInt64() & 0xFFFF))
            {
                case WM_LBUTTONUP:
                case WM_LBUTTONDBLCLK:
                case NIN_SELECT:
                case NIN_KEYSELECT:
                    Activated?.Invoke();
                    break;
                case WM_RBUTTONUP:
                case WM_CONTEXTMENU:
                    MenuRequested?.Invoke();
                    break;
                case NIN_BALLOONUSERCLICK:
                    NotificationClicked?.Invoke();
                    break;
            }
            return;
        }
        if (taskbarCreated != 0 && m.Msg == (int)taskbarCreated)
        {
            // Explorer restarted: the icon must be added again.
            Add();
            return;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (added)
        {
            var data = Data(0);
            Shell_NotifyIcon(NIM_DELETE, ref data);
            added = false;
        }
        DestroyHandle();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint message, ref NOTIFYICONDATA data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string name);
}
