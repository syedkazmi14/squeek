using System.Text;
using System.Text.Json;
using System.IO;

namespace Squeek.Observer;

public sealed record SourceIdentity(int ProcessId, string WindowHandle, long ProcessStartedAt);
public sealed record Region(double X, double Y, double Width, double Height);
public sealed record Command(string Kind, SourceIdentity? Source = null, Region? Region = null);

public static class Protocol
{
    public const int MaxFrameBytes = 65536;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static string? ReadFrame(Stream input)
    {
        var buffer = new byte[MaxFrameBytes];
        var count = 0;
        while (true)
        {
            var next = input.ReadByte();
            if (next == -1) return count == 0 ? null : StrictUtf8.GetString(buffer, 0, count);
            if (next == 10) return StrictUtf8.GetString(buffer, 0, count);
            if (count == buffer.Length) throw new InvalidDataException();
            buffer[count++] = (byte)next;
        }
    }

    public static Command Parse(string frame, string sessionId)
    {
        if (StrictUtf8.GetByteCount(frame) > MaxFrameBytes) throw new InvalidDataException();
        using var document = JsonDocument.Parse(frame);
        var root = document.RootElement;
        if (root.GetProperty("version").GetInt32() != 1 || root.GetProperty("sessionId").GetString() != sessionId)
            throw new InvalidDataException();
        var kind = root.GetProperty("kind").GetString();
        if (kind is "hello" or "pause" or "shutdown" or "foreground" or "changes")
        {
            RequireKeys(root, "kind", "version", "sessionId");
            return new Command(kind);
        }
        if (kind is not ("observe" or "watch")) throw new InvalidDataException();
        RequireKeys(root, "kind", "version", "sessionId", "source", "region");
        var source = root.GetProperty("source");
        RequireKeys(source, "processId", "windowHandle", "processStartedAt");
        var pid = source.GetProperty("processId").GetInt32();
        var handle = source.GetProperty("windowHandle").GetString();
        var startedAt = source.GetProperty("processStartedAt").GetInt64();
        if (pid <= 0 || startedAt <= 0 || startedAt > 9007199254740991 || handle is null ||
            !long.TryParse(handle, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var hwnd) ||
            hwnd <= 0 || handle != hwnd.ToString(System.Globalization.CultureInfo.InvariantCulture)) throw new InvalidDataException();
        var region = root.GetProperty("region");
        RequireKeys(region, "x", "y", "width", "height");
        var bounds = new Region(region.GetProperty("x").GetDouble(), region.GetProperty("y").GetDouble(),
            region.GetProperty("width").GetDouble(), region.GetProperty("height").GetDouble());
        if (new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }.Any(n => !double.IsFinite(n) || Math.Abs(n) > 100000) ||
            bounds.Width <= 0 || bounds.Height <= 0) throw new InvalidDataException();
        return new Command(kind, new SourceIdentity(pid, handle, startedAt), bounds);
    }

    private static void RequireKeys(JsonElement element, params string[] keys)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new InvalidDataException();
        var names = element.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Length != keys.Length || names.Distinct().Count() != names.Length || keys.Any(k => !names.Contains(k)))
            throw new InvalidDataException();
    }
}
