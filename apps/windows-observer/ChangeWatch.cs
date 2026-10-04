using System.Diagnostics;
using System.Windows.Automation;

namespace Squeek.Observer;

public sealed class ChangeWatch : IDisposable
{
    private AutomationElement? root;
    private SourceIdentity? source;
    private int dirty;
    private readonly AutomationEventHandler changed;
    private readonly AutomationPropertyChangedEventHandler property;
    private readonly StructureChangedEventHandler structure;
    private readonly AutomationFocusChangedEventHandler focus;
    public ChangeWatch()
    {
        changed = (_, _) => Interlocked.Exchange(ref dirty, 1);
        property = (_, _) => Interlocked.Exchange(ref dirty, 1);
        structure = (_, _) => Interlocked.Exchange(ref dirty, 1);
        focus = (_, _) => Interlocked.Exchange(ref dirty, 1);
    }
    public string Start(SourceIdentity identity, Region region)
    {
        Dispose();
        if (!ForegroundReader.Matches(identity)) return "foreground_mismatch";
        var supported = ForegroundReader.Foreground();
        if (supported is null || supported.Value.Source != identity) return "unsupported_app";
        try
        {
            root = AutomationElement.FromHandle(new nint(long.Parse(identity.WindowHandle)));
            var b = root.Current.BoundingRectangle;
            if (!ObservationPolicy.Contains(new Region(b.X, b.Y, b.Width, b.Height), region)) { Dispose(); return "region_outside_window"; }
            Automation.AddAutomationEventHandler(TextPattern.TextChangedEvent, root, TreeScope.Subtree, changed);
            Automation.AddAutomationPropertyChangedEventHandler(root, TreeScope.Subtree, property,
                AutomationElement.NameProperty, AutomationElement.BoundingRectangleProperty, AutomationElement.IsOffscreenProperty);
            Automation.AddStructureChangedEventHandler(root, TreeScope.Subtree, structure);
            Automation.AddAutomationFocusChangedEventHandler(focus);
            if (!ForegroundReader.Matches(identity)) { Dispose(); return "foreground_changed"; }
            source = identity;
            Interlocked.Exchange(ref dirty, 0);
            return "watching";
        }
        catch { Dispose(); return "subscription_failed"; }
    }
    public string Poll()
    {
        if (source is null || !ForegroundReader.Matches(source)) { Dispose(); return "foreground_changed"; }
        return Interlocked.Exchange(ref dirty, 0) == 1 ? "changed" : "unchanged";
    }
    public void Dispose()
    {
        if (root is not null)
        {
            try { Automation.RemoveAutomationEventHandler(TextPattern.TextChangedEvent, root, changed); } catch { }
            try { Automation.RemoveAutomationPropertyChangedEventHandler(root, property); } catch { }
            try { Automation.RemoveStructureChangedEventHandler(root, structure); } catch { }
            try { Automation.RemoveAutomationFocusChangedEventHandler(focus); } catch { }
        }
        root = null; source = null; Interlocked.Exchange(ref dirty, 0);
    }
}
