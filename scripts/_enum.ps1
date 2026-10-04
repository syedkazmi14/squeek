param([int]$procId)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, P cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public struct RECT { public int L, T, R, B; }
  public static List<string> Run(IntPtr top) {
    var o = new List<string>();
    EnumChildWindows(top, (h, l) => { var s = new StringBuilder(64); GetClassName(h, s, 64);
      if (s.ToString() == "Chrome_RenderWidgetHostHWND") { RECT r; GetWindowRect(h, out r); int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
        o.Add(h + " vis=" + IsWindowVisible(h) + " rect=" + r.L + "," + r.T + "," + r.R + "," + r.B + " parent=" + GetParent(h) + " cloaked=" + cloaked); }
      return true; }, IntPtr.Zero);
    return o;
  }
}
'@
$p = Get-Process -Id $procId; [W]::Run($p.MainWindowHandle)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$docs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
foreach ($d in $docs) { "DOC name=" + $d.Current.Name + " offscreen=" + $d.Current.IsOffscreen + " hwnd=" + $d.Current.NativeWindowHandle + " rect=" + $d.Current.BoundingRectangle }
$tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
foreach ($t in $tabs) { $sel = $null; try { $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch {}; "TAB name=" + $t.Current.Name + " selected=" + $sel }
"--- render widget elements"
$cache = New-Object System.Windows.Automation.CacheRequest
foreach ($line in [W]::Run($p.MainWindowHandle)) {
  $h = [IntPtr][long]($line.Split(' ')[0])
  $e = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  $kids = $e.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  "WIDGET $h type=" + $e.Current.ControlType.ProgrammaticName + " name=" + $e.Current.Name + " children=" + (($kids | % { $_.Current.ControlType.ProgrammaticName + ':' + $_.Current.Name }) -join ';')
}
"--- tab depth"
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$q = New-Object System.Collections.Queue; $q.Enqueue(@($root, 0)); $n = 0
while ($q.Count -gt 0 -and $n -lt 3000) { $item = $q.Dequeue(); $el = $item[0]; $d = $item[1]; $n++
  if ($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) { continue }
  if ($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem) { "TABITEM depth=$d visited=$n name=" + $el.Current.Name }
  $c = $walker.GetFirstChild($el); while ($c -ne $null) { $q.Enqueue(@($c, $d + 1)); $c = $walker.GetNextSibling($c) } }
"--- parents"
$raw = [System.Windows.Automation.TreeWalker]::RawViewWalker
foreach ($line in [W]::Run($p.MainWindowHandle)) {
  $h = [IntPtr][long]($line.Split(' ')[0])
  $e = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  $chain = @(); $x = $e
  for ($i = 0; $i -lt 4 -and $x -ne $null; $i++) { $x = $raw.GetParent($x); if ($x) { $chain += ($x.Current.ControlType.ProgrammaticName + ':' + $x.Current.Name) } }
  "WIDGET $h parents=" + ($chain -join ' <- ')
}
