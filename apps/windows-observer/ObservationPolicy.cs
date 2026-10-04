namespace Squeek.Observer;

public enum TextAccess { NoPattern, ReadOnly, Editable, Unknown }

public static class ObservationPolicy
{
    // Browsers expose a read-only ValuePattern (the URL) on every web document and link.
    // Only a writable value marks an input whose contents must never be read.
    public static bool WritableValue(bool hasValuePattern, bool isReadOnly) => hasValuePattern && !isReadOnly;
    public static bool MayTraverse(bool password, bool offscreen, bool editable, bool valuePattern, TextAccess textAccess) =>
        !password && !offscreen && !editable && !valuePattern &&
        textAccess is TextAccess.NoPattern or TextAccess.ReadOnly;
    public static bool Contains(Region outer, Region inner) =>
        new[] { outer.X, outer.Y, outer.Width, outer.Height, inner.X, inner.Y, inner.Width, inner.Height }.All(double.IsFinite) &&
        outer.Width > 0 && outer.Height > 0 && inner.Width > 0 && inner.Height > 0 &&
        inner.X >= outer.X && inner.Y >= outer.Y && inner.X + inner.Width <= outer.X + outer.Width &&
        inner.Y + inner.Height <= outer.Y + outer.Height;
}
