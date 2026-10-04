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

    public static bool Matches(SourceIdentity source)
    {
        try { return MatchesCore(source); } catch { return false; }
    }

    private static bool MatchesCore(SourceIdentity source)
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == 0 || hwnd.ToInt64().ToString() != source.WindowHandle || IsIconic(hwnd)) return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid != source.ProcessId || pid == Environment.ProcessId) return false;
        using var process = Process.GetProcessById(source.ProcessId);
        return new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() == source.ProcessStartedAt;
    }

    public static (SourceIdentity Source, Region Region, string ProcessName)? Foreground()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == 0 || IsIconic(hwnd)) return null;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == Environment.ProcessId) return null;
        using var process = Process.GetProcessById((int)pid);
        var name = process.ProcessName;
        if (name is not ("chrome" or "msedge" or "Squeek.Fixture")) return null;
        var source = new SourceIdentity((int)pid, hwnd.ToInt64().ToString(), new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds());
        var root = AutomationElement.FromHandle(hwnd);
        var b = root.Current.BoundingRectangle;
        var region = new Region(b.X, b.Y, b.Width, b.Height);
        if (new[] { region.X, region.Y, region.Width, region.Height }.Any(n => !double.IsFinite(n) || Math.Abs(n) > 100000) || !ObservationPolicy.Contains(region, region) || !Matches(source)) return null;
        return (source, region, name);
    }

    private const int MaxElements = 4000;
    private const int MaxSpans = 200;
    private const int MaxCharacters = 8000;
    // Stays well inside the parent's 2 s request deadline.
    private const int BudgetMs = 1200;

    [DllImport("user32.dll")] private static extern bool EnumChildWindows(nint parent, EnumWindowsProc callback, nint lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(nint hwnd, System.Text.StringBuilder name, int max);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    private delegate bool EnumWindowsProc(nint hwnd, nint lParam);

    // Chrome and Edge render each tab into a child window of this class; hidden tabs are not visible.
    private static List<nint> VisiblePageWindows(nint window)
    {
        var found = new List<nint>();
        var name = new System.Text.StringBuilder(64);
        EnumChildWindows(window, (child, _) =>
        {
            name.Clear();
            if (GetClassName(child, name, name.Capacity) > 0 && name.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(child))
                found.Add(child);
            return found.Count < 8;
        }, 0);
        return found;
    }

    private static CacheRequest Metadata()
    {
        // One cross-process round trip per element instead of one per property.
        var cache = new CacheRequest { TreeScope = TreeScope.Element };
        cache.Add(AutomationElement.ProcessIdProperty);
        cache.Add(AutomationElement.ControlTypeProperty);
        cache.Add(AutomationElement.IsPasswordProperty);
        cache.Add(AutomationElement.IsOffscreenProperty);
        cache.Add(AutomationElement.BoundingRectangleProperty);
        cache.Add(AutomationElement.NameProperty);
        cache.Add(AutomationElement.IsValuePatternAvailableProperty);
        cache.Add(AutomationElement.IsTextPatternAvailableProperty);
        cache.Add(ValuePattern.IsReadOnlyProperty);
        return cache;
    }

    private static bool IsInline(ControlType type) => type == ControlType.Text || type == ControlType.Hyperlink;

    public static ReadResult Read(SourceIdentity source, Region region)
    {
        if (!Matches(source)) return new("foreground_mismatch", []);
        var hwnd = new nint(long.Parse(source.WindowHandle));
        var cache = Metadata();
        var root = AutomationElement.FromHandle(hwnd).GetUpdatedCache(cache);
        var rootBounds = root.Cached.BoundingRectangle;
        if (!ObservationPolicy.Contains(new Region(rootBounds.X, rootBounds.Y, rootBounds.Width, rootBounds.Height), region))
            return new("region_outside_window", []);
        var walker = TreeWalker.RawViewWalker;
        var spans = new List<TextSpan>();
        var textCount = 0;
        // Browsers split one sentence into a node per inline element ("buy ", "$500", " in gift cards").
        // Consecutive leaves inside the same block are rejoined so phrases survive formatting.
        var blockText = new System.Text.StringBuilder();
        Region? blockRect = null;
        Region? lastPart = null;
        var currentBlock = -1;
        void Flush()
        {
            var text = blockText.ToString().Trim();
            if (text.Length > 0 && blockRect is not null && spans.Count < MaxSpans && textCount + text.Length <= MaxCharacters)
            { spans.Add(new TextSpan(text, blockRect)); textCount += text.Length; }
            blockText.Clear(); blockRect = null; lastPart = null;
        }
        void Append(int block, string name, Region rect)
        {
            if (block != currentBlock) { Flush(); currentBlock = block; }
            // Inline pieces of one sentence start inside the previous piece's vertical extent;
            // text stacked below it is a separate line or paragraph, not a continuation.
            if (lastPart is not null && rect.Y >= lastPart.Y + lastPart.Height - 1) Flush();
            blockText.Append(name);
            blockRect = blockRect is null ? rect : Union(blockRect, rect);
            lastPart = rect;
        }
        // Depth-first in document order; each entry carries the block (nearest non-inline ancestor) it belongs to.
        var stack = new Stack<(AutomationElement Element, int Block)>();
        // Web content lives only in the browser's page windows (one per tab, only the active one visible).
        // Seeding from them skips the tab strip, toolbar and hundreds of buttons that would otherwise spend the
        // whole time budget, and costs a Win32 window enumeration instead of a search of the accessibility tree.
        var seeds = new List<AutomationElement>();
        foreach (var page in VisiblePageWindows(hwnd))
        {
            try { seeds.Add(AutomationElement.FromHandle(page).GetUpdatedCache(cache)); }
            catch (ElementNotAvailableException) { }
        }
        // Without page windows (a native app, or a browser that hosts content differently) look for on-screen
        // Document elements, and failing that walk from the root.
        var seeded = new HashSet<string>();
        var started = new HashSet<string>();
        if (seeds.Count == 0)
        {
            using (cache.Activate())
            {
                var found = root.FindAll(TreeScope.Descendants, new AndCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document),
                    new PropertyCondition(AutomationElement.IsOffscreenProperty, false)));
                foreach (AutomationElement document in found) { seeds.Add(document); seeded.Add(string.Join(",", document.GetRuntimeId())); }
            }
        }
        if (seeds.Count == 0) stack.Push((root, 0));
        else for (var i = seeds.Count - 1; i >= 0; i--) stack.Push((seeds[i], 0));
        var blocks = 0;
        var count = 0;
        var children = new List<AutomationElement>();
        var timer = Stopwatch.StartNew();
        while (stack.Count > 0 && count++ < MaxElements && timer.ElapsedMilliseconds < BudgetMs &&
               spans.Count < MaxSpans && textCount + blockText.Length < MaxCharacters)
        {
            if (count % 64 == 0 && GetForegroundWindow() != hwnd) return new("foreground_changed", []);
            var (element, block) = stack.Pop();
            try
            {
                // Read protection/type metadata before a name; never read Value or document-wide text.
                var info = element.Cached;
                if (info.ProcessId != source.ProcessId) continue;
                // A document nested in another (an iframe) is reached through its parent and again as a seed.
                if (info.ControlType == ControlType.Document && seeded.Count > 0 && !started.Add(string.Join(",", element.GetRuntimeId()))) continue;
                var textAccess = TextAccess.NoPattern;
                if ((bool)element.GetCachedPropertyValue(AutomationElement.IsTextPatternAvailableProperty) &&
                    element.TryGetCurrentPattern(TextPattern.Pattern, out var pattern))
                {
                    var attribute = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                    textAccess = attribute is bool readOnly ? (readOnly ? TextAccess.ReadOnly : TextAccess.Editable) : TextAccess.Unknown;
                    // A page that contains any editable field (a reply box, a search bar) reports "mixed" for the
                    // whole document. That says nothing about the static text around it; each editable element is
                    // excluded on its own below, so only a fully editable document stays unreadable.
                    if (info.ControlType == ControlType.Document && textAccess == TextAccess.Unknown)
                        textAccess = TextAccess.ReadOnly;
                }
                var hasValue = (bool)element.GetCachedPropertyValue(AutomationElement.IsValuePatternAvailableProperty);
                var writableValue = ObservationPolicy.WritableValue(hasValue,
                    hasValue && element.GetCachedPropertyValue(ValuePattern.IsReadOnlyProperty, true) is true);
                if (!ObservationPolicy.MayTraverse(info.IsPassword, info.IsOffscreen,
                    info.ControlType == ControlType.Edit || info.ControlType == ControlType.ComboBox,
                    writableValue, textAccess)) continue;
                var childBlock = IsInline(info.ControlType) ? block : ++blocks;
                children.Clear();
                var child = walker.GetFirstChild(element, cache);
                // Bound sibling traversal as well as the outer stack; hostile providers cannot grow it indefinitely.
                for (var siblings = 0; child is not null && siblings < MaxElements && stack.Count + children.Count < MaxElements; siblings++)
                { children.Add(child); child = walker.GetNextSibling(child, cache); }
                // Only leaves carry text; a heading's own name repeats its child text.
                if (info.ControlType == ControlType.Text && children.Count == 0)
                {
                    var bounds = info.BoundingRectangle;
                    var rect = new Region(bounds.X, bounds.Y, bounds.Width, bounds.Height);
                    if (info.Name.Length > 0 && !string.IsNullOrWhiteSpace(info.Name) && ObservationPolicy.Contains(region, rect))
                        Append(block, info.Name, rect);
                }
                for (var i = children.Count - 1; i >= 0; i--) stack.Push((children[i], childBlock));
            }
            // Live pages remove nodes mid-walk; one vanished element must not discard the whole read.
            catch (ElementNotAvailableException) { }
        }
        Flush();
        if (!Matches(source)) return new("foreground_changed", []);
        if (spans.Count == 0) return new("no_visible_text", []);
        return new(null, spans);
    }

    private static Region Union(Region a, Region b)
    {
        var x = Math.Min(a.X, b.X);
        var y = Math.Min(a.Y, b.Y);
        return new Region(x, y, Math.Max(a.X + a.Width, b.X + b.Width) - x, Math.Max(a.Y + a.Height, b.Y + b.Height) - y);
    }
}
