using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace Squeek.Observer;

public sealed record LinkResult(string? Code, string Url, string Text, Region? Rect);

/// <summary>Reads the hyperlink under the cursor in the watched browser window.</summary>
public static class LinkReader
{
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);

    public const int MaxUrl = 2048;
    public const int MaxText = 300;
    // The element under the cursor is usually the link's text; the link is a parent or two up.
    private const int MaxAncestors = 6;

    private static LinkResult None(string code) => new(code, "", "", null);

    public static LinkResult Read(SourceIdentity source, Region region)
    {
        if (!ForegroundReader.Matches(source)) return None("foreground_mismatch");
        if (!GetCursorPos(out var cursor) || !ObservationPolicy.Contains(region, new Region(cursor.X, cursor.Y, 1, 1)))
            return None("no_link");
        var element = AutomationElement.FromPoint(new System.Windows.Point(cursor.X, cursor.Y));
        var walker = TreeWalker.RawViewWalker;
        for (var depth = 0; element is not null && depth < MaxAncestors; depth++)
        {
            var info = element.Current;
            // Anything over the page (another app, Squeek's own overlay) is not the watched page.
            if (info.ProcessId != source.ProcessId || info.IsPassword) return None("no_link");
            if (info.ControlType == ControlType.Hyperlink) return Describe(element, info, source, region);
            if (info.ControlType == ControlType.Document) break;
            element = walker.GetParent(element);
        }
        return None("no_link");
    }

    private static LinkResult Describe(AutomationElement link, AutomationElement.AutomationElementInformation info,
        SourceIdentity source, Region region)
    {
        // Browsers expose a link's address as a read-only value; a writable value is an input, never read.
        if (!link.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)) return None("no_link");
        var value = (ValuePattern)pattern;
        if (!value.Current.IsReadOnly) return None("no_link");
        var url = value.Current.Value?.Trim() ?? "";
        if (url.Length == 0 || url.Length > MaxUrl) return None("no_link");
        var text = info.Name?.Trim() ?? "";
        if (text.Length > MaxText) text = text[..MaxText];
        var b = info.BoundingRectangle;
        var rect = Clip(new Region(b.X, b.Y, b.Width, b.Height), region);
        if (rect is null) return None("no_link");
        if (!ForegroundReader.Matches(source)) return None("foreground_changed");
        return new(null, url, text, rect);
    }

    /// <summary>A link scrolled partly out of the window still counts; only its visible part is reported.</summary>
    private static Region? Clip(Region inner, Region outer)
    {
        if (new[] { inner.X, inner.Y, inner.Width, inner.Height }.Any(n => !double.IsFinite(n))) return null;
        var x = Math.Max(inner.X, outer.X);
        var y = Math.Max(inner.Y, outer.Y);
        var right = Math.Min(inner.X + inner.Width, outer.X + outer.Width);
        var bottom = Math.Min(inner.Y + inner.Height, outer.Y + outer.Height);
        if (right - x < 1 || bottom - y < 1) return null;
        return new Region(x, y, right - x, bottom - y);
    }
}
