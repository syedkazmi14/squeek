using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;

internal static class Program
{
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out NativeRect rect);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(nint context);
    [STAThread] private static void Main()
    {
        SetProcessDpiAwarenessContext(new nint(-4));
        var app = new Application();
        var panel = new StackPanel { Margin = new Thickness(30) };
        var visible = new TextBlock { Text = "Synthetic visible fixture text", Margin = new Thickness(5) };
        var outside = new TextBlock { Text = "Synthetic outside region text", Margin = new Thickness(5) };
        panel.Children.Add(visible); panel.Children.Add(outside);
        panel.Children.Add(new TextBox { Text = "Synthetic editable secret", Margin = new Thickness(5) });
        panel.Children.Add(new PasswordBox { Password = "Synthetic password secret", Margin = new Thickness(5) });
        panel.Children.Add(new TextBlock { Text = "Synthetic hidden secret", Visibility = Visibility.Collapsed });
        var offscreenPanel = new StackPanel();
        offscreenPanel.Children.Add(new Border { Height = 400 });
        offscreenPanel.Children.Add(new TextBlock { Text = "Synthetic offscreen secret" });
        panel.Children.Add(new ScrollViewer { Height = 40, Content = offscreenPanel });
        var window = new Window { Title = "Squeek synthetic fixture", Width = 650, Height = 420, Left = 80, Top = 80, Content = panel };
        window.ContentRendered += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            SetForegroundWindow(hwnd);
            if (!GetWindowRect(hwnd, out var b)) throw new InvalidOperationException("Owned fixture bounds unavailable");
            var point = visible.PointToScreen(new Point(0, 0));
            var end = visible.PointToScreen(new Point(visible.ActualWidth, visible.ActualHeight));
            using var process = Process.GetCurrentProcess();
            Console.WriteLine(JsonSerializer.Serialize(new { source = new { processId = Environment.ProcessId,
                windowHandle = hwnd.ToInt64().ToString(), processStartedAt = new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() },
                region = new { x = b.Left, y = b.Top, width = b.Right - b.Left, height = b.Bottom - b.Top },
                narrow = new { x = point.X, y = point.Y, width = end.X - point.X, height = end.Y - point.Y }, foreground = GetForegroundWindow() == hwnd }));
            _ = Task.Run(() =>
            {
                string? command;
                while ((command = Console.ReadLine()) is not null)
                {
                    if (command == "close") { app.Dispatcher.Invoke(window.Close); break; }
                    if (command == "change") app.Dispatcher.Invoke(() => visible.Text = "Synthetic changed fixture text");
                    if (command == "focus") app.Dispatcher.Invoke(() => SetForegroundWindow(hwnd));
                }
            });
        };
        app.Run(window);
    }
}
