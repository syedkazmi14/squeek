using System.Runtime.InteropServices;

namespace Squeek.Observer;

/// <summary>
/// Hold-to-talk. Reports only Ctrl going down and up, and "other" when any other key or a
/// mouse button is pressed while Ctrl is held (that is a shortcut, not talking). It never
/// reports which other key was pressed, and nothing at all while Ctrl is up.
/// </summary>
public static class KeyWatch
{
    private const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int WM_LBUTTONDOWN = 0x0201, WM_RBUTTONDOWN = 0x0204, WM_MBUTTONDOWN = 0x0207, WM_XBUTTONDOWN = 0x020B;
    private const uint VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3;

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInfo { public uint VkCode, ScanCode, Flags, Time; public nint Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message { public nint Hwnd; public uint Msg; public nint WParam, LParam; public uint Time; public int X, Y; }
    private delegate nint HookProc(int code, nint wParam, nint lParam);

    [DllImport("user32.dll", SetLastError = true)] private static extern nint SetWindowsHookEx(int id, HookProc proc, nint module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook, int code, nint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, nint hwnd, uint min, uint max);
    [DllImport("kernel32.dll")] private static extern nint GetModuleHandle(string? name);

    // Kept in fields so the garbage collector cannot free the callbacks while hooks use them.
    private static HookProc? keyboardProc, mouseProc;
    private static readonly HashSet<uint> held = [];
    private static bool chord;

    public static void Run()
    {
        // Squeek closing our stdin is the signal to exit.
        _ = Task.Run(() => { try { Console.In.ReadToEnd(); } catch { } Environment.Exit(0); });
        keyboardProc = OnKey;
        mouseProc = OnMouse;
        var module = GetModuleHandle(null);
        var keyboard = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0);
        var mouse = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
        if (keyboard == 0 || mouse == 0) { Emit("unavailable"); return; }
        Emit("ready");
        // Low-level hooks are called on this thread's message loop.
        while (GetMessage(out _, 0, 0, 0) > 0) { }
        UnhookWindowsHookEx(keyboard);
        UnhookWindowsHookEx(mouse);
    }

    private static void Emit(string kind) { Console.Out.WriteLine(kind); Console.Out.Flush(); }

    private static nint OnKey(int code, nint wParam, nint lParam)
    {
        if (code >= 0)
        {
            var vk = Marshal.PtrToStructure<KeyboardInfo>(lParam).VkCode;
            var message = (int)wParam;
            var down = message is WM_KEYDOWN or WM_SYSKEYDOWN;
            var up = message is WM_KEYUP or WM_SYSKEYUP;
            if (vk is VK_LCONTROL or VK_RCONTROL)
            {
                // Holding a key repeats key-down; only the first press counts.
                if (down && held.Add(vk) && held.Count == 1) { chord = false; Emit("down"); }
                if (up && held.Remove(vk) && held.Count == 0) Emit("up");
            }
            else if (down && held.Count > 0 && !chord) { chord = true; Emit("other"); }
        }
        return CallNextHookEx(0, code, wParam, lParam);
    }

    private static nint OnMouse(int code, nint wParam, nint lParam)
    {
        if (code >= 0 && held.Count > 0 && !chord &&
            (int)wParam is WM_LBUTTONDOWN or WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_XBUTTONDOWN)
        { chord = true; Emit("other"); }
        return CallNextHookEx(0, code, wParam, lParam);
    }
}
