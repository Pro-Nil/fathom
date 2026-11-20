#if WINDOWS
using System.Runtime.InteropServices;
using Avalonia.Controls;

namespace PentestHarness.Desktop;

/// <summary>
/// Windows only: removes the native caption so the page's own bar is the
/// title bar, while keeping the frame (resize borders, shadow, rounded corners
/// and snap). The page marks its bar <c>app-region: drag</c>, which WebView2
/// turns into a real caption (drag, double-click to maximize, snap layouts).
/// </summary>
internal static class WindowFrame
{
    /// <summary>Height of the strip above the web view that keeps the top edge resizable.</summary>
    public const int ResizeStrip = 3;

    private const uint WM_NCCALCSIZE = 0x0083, WM_NCHITTEST = 0x0084;
    private const int HTCLIENT = 1, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;

    /// <summary>Hook the window's messages and recompute its frame.</summary>
    public static void Attach(Window window)
    {
        Win32Properties.AddWndProcHookCallback(window, Hook);
        if (window.TryGetPlatformHandle()?.Handle is { } hwnd && hwnd != IntPtr.Zero)
        {
            // SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0004 | 0x0010 | 0x0020);
            HarnessServer.AppLog($"custom frame attached before show: {!IsWindowVisible(hwnd)}");
        }
        else
        {
            HarnessServer.AppLog("custom frame: no window handle yet");
        }
    }

    private static IntPtr Hook(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_NCCALCSIZE && wParam != IntPtr.Zero)
        {
            // Let Windows size the side and bottom borders, then put the top
            // back where it was: the caption disappears, the frame stays. A
            // maximized window hangs its frame off-screen, so keep that inset.
            var before = Marshal.PtrToStructure<RECT>(lParam);
            DefWindowProcW(hwnd, msg, wParam, lParam);
            var after = Marshal.PtrToStructure<RECT>(lParam);
            after.Top = before.Top + (IsZoomed(hwnd) ? FrameInset(hwnd) : 0);
            Marshal.StructureToPtr(after, lParam, false);
            handled = true;
            return IntPtr.Zero;
        }
        if (msg == WM_NCHITTEST)
        {
            var result = DefWindowProcW(hwnd, msg, wParam, lParam);
            handled = true;
            if (result != HTCLIENT || IsZoomed(hwnd)) return result;
            // The web view covers the client area except a thin strip at the top;
            // that strip (and the corners) resizes the window.
            var lp = lParam.ToInt64();
            var point = new POINT { X = (short)(lp & 0xFFFF), Y = (short)((lp >> 16) & 0xFFFF) };
            ScreenToClient(hwnd, ref point);
            if (point.Y >= ResizeStrip * GetDpiForWindow(hwnd) / 96) return result;
            GetClientRect(hwnd, out var client);
            return point.X < 10 ? HTTOPLEFT : point.X > client.Right - 10 ? HTTOPRIGHT : HTTOP;
        }
        return IntPtr.Zero;
    }

    private static int FrameInset(IntPtr hwnd)
    {
        var dpi = GetDpiForWindow(hwnd);
        return GetSystemMetricsForDpi(33 /* SM_CYFRAME */, dpi) + GetSystemMetricsForDpi(92 /* SM_CXPADDEDBORDER */, dpi);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    [DllImport("user32.dll")] private static extern IntPtr DefWindowProcW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern int GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetSystemMetricsForDpi(int index, int dpi);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
#endif
