using Squeek.Observer;

var count = 0;
void Check(bool actual, bool expected, string name)
{
    count++;
    if (actual != expected) { Console.Error.WriteLine($"FAIL {name}"); Environment.Exit(1); }
}
Check(ObservationPolicy.MayTraverse(false, false, false, false, TextAccess.NoPattern), true, "static container");
Check(ObservationPolicy.MayTraverse(false, false, false, false, TextAccess.ReadOnly), true, "read-only text provider");
Check(ObservationPolicy.MayTraverse(true, false, false, false, TextAccess.NoPattern), false, "password ancestor");
Check(ObservationPolicy.MayTraverse(false, true, false, false, TextAccess.NoPattern), false, "offscreen ancestor");
Check(ObservationPolicy.MayTraverse(false, false, true, false, TextAccess.NoPattern), false, "editable control ancestor");
Check(ObservationPolicy.MayTraverse(false, false, false, true, TextAccess.NoPattern), false, "value control ancestor");
Check(ObservationPolicy.MayTraverse(false, false, false, false, TextAccess.Editable), false, "editable Document without ValuePattern");
Check(ObservationPolicy.MayTraverse(false, false, false, false, TextAccess.Unknown), false, "unknown or mixed text provider");
var region = new Region(-100, 0, 300, 200);
Check(ObservationPolicy.Contains(region, new(-50, 20, 100, 100)), true, "contained text on negative-coordinate display");
Check(ObservationPolicy.Contains(region, new(-101, 20, 100, 100)), false, "partially outside region");
Check(ObservationPolicy.Contains(region, new(0, 20, 0, 100)), false, "empty bounds");
Check(ObservationPolicy.Contains(region, new(double.NaN, 20, 100, 100)), false, "invalid bounds");
Console.WriteLine($"PASS {count} native policy assertions");
