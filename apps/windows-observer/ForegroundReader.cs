using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace Squeek.Observer;

public sealed record TextSpan(string Text, Region Rect);
public sealed record ReadResult(string? Code, List<TextSpan> Spans);

public static class ForegroundReader
{
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);

    private static bool Matches(SourceIdentity source)
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == 0 || hwnd.ToInt64().ToString() != source.WindowHandle || IsIconic(hwnd)) return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid != source.ProcessId || pid == Environment.ProcessId) return false;
        using var process = Process.GetProcessById(source.ProcessId);
        return new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() == source.ProcessStartedAt;
    }

    public static ReadResult Read(SourceIdentity source, Region region)
    {
        if (!Matches(source)) return new("foreground_mismatch", []);
        var root = AutomationElement.FromHandle(new nint(long.Parse(source.WindowHandle)));
        var rootBounds = root.Current.BoundingRectangle;
        if (!ObservationPolicy.Contains(new Region(rootBounds.X, rootBounds.Y, rootBounds.Width, rootBounds.Height), region))
            return new("region_outside_window", []);
        var walker = TreeWalker.RawViewWalker;
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        var spans = new List<TextSpan>();
        var count = 0;
        var textCount = 0;
        var timer = Stopwatch.StartNew();
        while (queue.Count > 0 && count++ < 1500 && timer.ElapsedMilliseconds < 750 && spans.Count < 200)
        {
            if (!Matches(source)) return new("foreground_changed", []);
            var element = queue.Dequeue();
            // Read protection/type metadata before a name; never read Value or document-wide text.
            var info = element.Current;
            if (info.ProcessId != source.ProcessId) continue;
            var textAccess = TextAccess.NoPattern;
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var pattern))
            {
                var attribute = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                textAccess = attribute is bool readOnly ? (readOnly ? TextAccess.ReadOnly : TextAccess.Editable) : TextAccess.Unknown;
            }
            if (!ObservationPolicy.MayTraverse(info.IsPassword, info.IsOffscreen,
                info.ControlType == ControlType.Edit || info.ControlType == ControlType.ComboBox,
                element.TryGetCurrentPattern(ValuePattern.Pattern, out _), textAccess)) continue;
            var bounds = info.BoundingRectangle;
            var rect = new Region(bounds.X, bounds.Y, bounds.Width, bounds.Height);
            if (info.ControlType == ControlType.Text && ObservationPolicy.Contains(region, rect))
            {
                var text = info.Name.Trim();
                if (text.Length > 0 && text.Length + textCount <= 8000)
                { spans.Add(new TextSpan(text, rect)); textCount += text.Length; }
            }
            // Bound sibling traversal as well as the outer queue; hostile providers cannot grow it indefinitely.
            var child = walker.GetFirstChild(element);
            for (var siblings = 0; child is not null && siblings < 1500 && queue.Count < 1500; siblings++)
            { queue.Enqueue(child); child = walker.GetNextSibling(child); }
        }
        if (!Matches(source)) return new("foreground_changed", []);
        if (spans.Count == 0) return new("no_visible_text", []);
        return new(null, spans);
    }
}
