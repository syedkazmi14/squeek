using System.Text;
using System.Text.Json;
using System.IO;
using System.Runtime.InteropServices;
using Squeek.Observer;

// A separate, minimal mode: hold-to-talk key events only (see KeyWatch).
if (args is ["--keys"]) { KeyWatch.Run(); return; }
if (args.Length != 2 || args[0] != "--session" || !Guid.TryParseExact(args[1], "D", out _)) return;
NativeDpi.SetProcessDpiAwarenessContext(new nint(-4));
var sessionId = args[1];
var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
void Emit(object value) => Console.WriteLine(JsonSerializer.Serialize(value, options));
void Health(string state, string code) => Emit(new { kind = "health", version = 1, sessionId, state, code });
long revision = 0;
using var watch = new ChangeWatch();
Emit(new { kind = "ready", version = 1, sessionId });
using var input = Console.OpenStandardInput();
while (true)
{
    string? frame;
    try { frame = Protocol.ReadFrame(input); }
    catch (Exception e) when (e is InvalidDataException or DecoderFallbackException)
    { Health("unavailable", "invalid_command"); break; }
    if (frame is null) break;
    Command command;
    try { command = Protocol.Parse(frame, sessionId); }
    catch (Exception e) when (e is JsonException or InvalidDataException or InvalidOperationException or KeyNotFoundException or FormatException or OverflowException)
    { Health("unavailable", "invalid_command"); continue; }
    if (command.Kind == "shutdown") { watch.Dispose(); Emit(new { kind = "stopped", version = 1, sessionId }); break; }
    if (command.Kind == "hello") { Health("paused", "not_monitoring"); continue; }
    if (command.Kind == "pause") { watch.Dispose(); Health("paused", "paused"); continue; }
    try
    {
        if (command.Kind == "foreground")
        {
            var foreground = ForegroundReader.Foreground();
            if (foreground is null) Health("unsupported", "unsupported_app");
            else Emit(new { kind = "foreground", version = 1, sessionId, source = foreground.Value.Source,
                region = foreground.Value.Region, processName = foreground.Value.ProcessName });
            continue;
        }
        if (command.Kind == "changes")
        {
            var code = watch.Poll(); Health(code == "foreground_changed" ? "unsupported" : "available", code); continue;
        }
        var source = command.Source!;
        if (command.Kind == "watch")
        {
            var code = watch.Start(source, command.Region!); Health(code == "watching" ? "available" : "unsupported", code); continue;
        }
        if (command.Kind == "link")
        {
            var link = LinkReader.Read(source, command.Region!);
            if (link.Code == "no_link") Health("available", "no_link");
            else if (link.Code is not null) Health("unsupported", link.Code);
            else Emit(new { kind = "link", version = 1, sessionId, source, url = link.Url, text = link.Text, rect = link.Rect });
            continue;
        }
        var result = ForegroundReader.Read(source, command.Region!);
        if (result.Code is not null) { Health("unsupported", result.Code); continue; }
        if (revision >= 9007199254740991) { Health("unavailable", "revision_exhausted"); continue; }
        Emit(new { kind = "observation", version = 1, sessionId, source, revision = ++revision,
            observedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), provenance = "accessibility",
            coverage = "partial", spans = result.Spans });
    }
    catch (Exception error) { Console.Error.WriteLine(error.GetType().Name); Health("unavailable", "read_failed"); }
}


internal static class NativeDpi
{
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(nint context);
}
