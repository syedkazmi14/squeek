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
- Controlled WPF fixture extraction is verified by `tests/native-extraction.test.ts`: visible static labels are extracted, editable/password/collapsed/offscreen controls are excluded, physical region containment is enforced, and a stale process-start identity is rejected. The fixture owns its window and synthetic text; it never reads a user app.
- Chrome/Gmail accessibility text, document-change identity, message-specific scoping, and event coverage are not verified. No browser support is claimed.
- Accessibility bounds and offscreen metadata do not prove that pixels are unoccluded, or that an apparent static label contains no sensitive information. Region selection and local minimization/redaction need further validation before cloud integration.
- The current generic probe reports `partial` for every observation. `no_visible_text` and foreground changes report unsupported; errors report unavailable. Neither means safe.
- UIA text/property/structure/focus subscriptions are implemented as dirtiness signals. The controlled fixture verified a text/property change. Real-browser event coverage and OCR remain separate gates. Desktop scheduling, detection, optional fake-transport Jev, Electron UI, voice discovery and packaging results are recorded in [desktop results](demo-results.md).

Record actual OS/browser versions, source type, visible-versus-extracted content, protected controls, document changes, foreground transitions, DPI/multiple displays, provider stalls, and helper cleanup when executing the feasibility gate. Keep private correspondence and screenshots out of Git and logs.

## Controlled native fixture and metadata protocol

Build the owned synthetic WPF fixture with the same self-contained framework as the observer:

```powershell
.tools/dotnet/dotnet.exe publish tests/Windows.Fixture -c Release -r win-x64 --self-contained -o artifacts/windows-fixture
node --experimental-strip-types --test tests/contracts.test.ts tests/windows-observer.test.ts tests/native-extraction.test.ts
```

The fixture briefly opens its own window and requests foreground activation without injecting input. If Windows refuses activation, the extraction test explicitly skips rather than claiming native coverage. It closes that owned window afterward. Observer and fixture opt into per-monitor DPI awareness; additional DPI and multiple-display cases remain manual gates.

`foreground` returns only process identity, physical root rectangle, and one allowlisted process name (`chrome`, `msedge`, `Squeek.Fixture`). It reads no accessibility names, title, values, or text. Other foreground processes produce `unsupported_app`. No browser URL, sender, or message identity is inferred.

`watch` requires the same exact opted source and region fields as `observe`. It validates the foreground identity and root containment, attaches UIA subscriptions, and returns `watching`. Callbacks only mark an atomic dirty flag; they emit no stdout frames or content. `changes` returns `changed` or `unchanged` and resets the flag. Lost source returns `foreground_changed`; registration failure returns `subscription_failed`. Global focus signals may conservatively mark the watch dirty. Pause/shutdown detach subscriptions and clear state. Responses remain one per command; only extraction emits spans.

This verifies generic WPF feasibility, not Chrome/Gmail message-specific support, occlusion, URL restrictions, sensitive-region discovery, or comprehensive UIA event delivery. Real correspondence remains an explicit separate gate.

The owned Chrome 154.0.8037.58 probe observed one exact-owned-PID extraction failure (`read_failed`); later attempts skipped after Windows refused foreground activation. It never observed unrelated window text. Chrome compatibility remains unverified. Native diagnostic stderr contains exception type only, never raw exception messages or observed text.
