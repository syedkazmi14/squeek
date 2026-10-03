using System.Text;
using System.Text.Json;
using System.IO;
using Squeek.Observer;

if (args.Length != 2 || args[0] != "--session" || !Guid.TryParseExact(args[1], "D", out _)) return;
var sessionId = args[1];
var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
void Emit(object value) => Console.WriteLine(JsonSerializer.Serialize(value, options));
void Health(string state, string code) => Emit(new { kind = "health", version = 1, sessionId, state, code });
long revision = 0;
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
    if (command.Kind == "shutdown") { Emit(new { kind = "stopped", version = 1, sessionId }); break; }
    if (command.Kind == "hello") { Health("paused", "not_monitoring"); continue; }
    if (command.Kind == "pause") { Health("paused", "paused"); continue; }
    try
    {
        var source = command.Source!;
        var result = ForegroundReader.Read(source, command.Region!);
        if (result.Code is not null) { Health("unsupported", result.Code); continue; }
        Emit(new { kind = "observation", version = 1, sessionId, source, revision = ++revision,
            observedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), provenance = "accessibility",
            coverage = "partial", spans = result.Spans });
    }
    catch { Health("unavailable", "read_failed"); }
}
