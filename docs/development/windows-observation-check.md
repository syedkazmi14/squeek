# Windows observation development check

The foundation is a developer feasibility probe, not an Electron interface or enabled scam monitor. It makes no cloud calls. The native observer is self-contained and communicates through the parent process's inherited stdin/stdout pipes; it opens no network listener.

## Setup

Use Windows 11 x64, Node.js 24 or newer, and a .NET 10 SDK for development. End users will not need these developer tools once an installer exists. A local SDK can be placed in ignored `.tools/dotnet`; the build script prefers that path, then uses `dotnet` from PATH. The Microsoft [non-admin installation script](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-install-script) accepts an explicit installation directory and `-NoPath`.

Run from the development worktree:

```powershell
npm.cmd ci
npm.cmd run observer:build
npm.cmd test
npm.cmd run typecheck
npm.cmd run observer:probe
```

The default probe checks startup, paused health, and shutdown. It does not collect screen text. The observer starts without monitoring and never accesses the clipboard, microphone, screenshot capture, or browser debug ports.

## Explicit extraction check

Before reading a real app, explicitly select a non-sensitive foreground window and an approved rectangle. Source JSON requires exact `processId`, decimal-string `windowHandle`, and process-start Unix milliseconds as `processStartedAt`. Region JSON requires physical Windows screen coordinates `x`, `y`, `width`, and `height` wholly inside that window. Metadata changes and reused handles invalidate the request.

```powershell
npm.cmd run observer:probe -- --observe '<source-json>' '<region-json>'
```

The placeholders above are not runnable source data. The probe outputs health or counts only, never extracted text. A pending read times out in the parent after two seconds; the parent terminates the helper. Use a controlled synthetic fixture for detailed extraction assertions before trying private correspondence.

The initial reader traverses at most 1,500 accessibility elements, up to 200 spans and 8,000 text characters, with a cooperative 750 ms traversal budget. A single provider call may stall beyond that budget; the independent parent deadline is the hard process boundary. It reads only static text names, excludes password/editable/ValuePattern subtrees, and checks offscreen flags and rectangle containment. No whole-document text or editable field values are read. See Microsoft's [password property](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.ispasswordproperty) and [bounding rectangle](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.automationelementinformation.boundingrectangle) documentation.

## Evidence and remaining gates

The reader also excludes editable, mixed, and unknown TextPattern containers; a text provider must explicitly report read-only before traversal.

- Automated tests cover strict TypeScript frames, child startup, invalid/oversized output, timeouts, crash/EOF, forged sessions, stale revisions, command mutation during startup, native command validation, paused startup, foreground mismatch, and native policy decisions for editable/protected ancestry and rectangle containment.
- Initial verification: 20 Node test cases passed, including a C# harness with 12 policy assertions; TypeScript checking and self-contained Windows publishing passed. These results do not establish real-browser support.
- Self-contained win-x64 publishing has been exercised on the development machine.
- Successful extraction from a controlled native fixture is still pending. Password/editable/offscreen filtering and rectangle behavior require that native fixture test, not just code inspection.
- Chrome/Gmail accessibility text, document-change identity, message-specific scoping, and event coverage are not verified. No browser support is claimed.
- Accessibility bounds and offscreen metadata do not prove that pixels are unoccluded, or that an apparent static label contains no sensitive information. Region selection and local minimization/redaction need further validation before cloud integration.
- The current generic probe reports `partial` for every observation. `no_visible_text` and foreground changes report unsupported; errors report unavailable. Neither means safe.
- Event subscriptions, automatic scheduling, OCR, detection, Jev, Electron UI, voice, and installer packaging remain planned work.

Record actual OS/browser versions, source type, visible-versus-extracted content, protected controls, document changes, foreground transitions, DPI/multiple displays, provider stalls, and helper cleanup when executing the feasibility gate. Keep private correspondence and screenshots out of Git and logs.
