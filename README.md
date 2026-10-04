# squeek

- [Implementation plan](docs/superpowers/plans/2026-10-03-squeek-implementation.md)
- [Design](docs/superpowers/specs/2026-10-03-squeek-scam-protection-design.md)
- [Desktop development and packaging](docs/development/desktop.md)
- [Windows observation checks](docs/development/windows-observation-check.md)
- [Detection evaluation](docs/development/evaluation.md)
- [Windows release gates and disposable installation checks](docs/development/installation.md)

## Development

```powershell
npm.cmd ci
npm.cmd run desktop:setup
npm.cmd run observer:build
npm.cmd run build
npm.cmd start
```

Build tools require Node 24 or newer and a .NET 10 SDK. The build script also accepts a local SDK at `.tools/dotnet/dotnet.exe`. Installed users do not need these tools: the Windows package includes Electron and the self-contained observer.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:desktop
npm.cmd run test:usability
npm.cmd run evaluate
npm.cmd run package:win
npm.cmd run release:audit
```

Squeek starts in the Windows tray with its cursor companion visible and the review sidebar hidden. Use the tray to start Chrome or Edge monitoring or open Settings. Only the selected foreground browser is eligible for observation. Closing the sidebar leaves enabled monitoring running; Pause and Quit are explicit tray actions. New suspicious assessments open the sidebar automatically. Manual check accepts user-entered text; Open demo opens a local simulation whose exact action requires review. External pages receive advisory warnings only.

The default and packaged app use local English rules and Windows local speech. Image-only content, unsupported accessibility trees, incomplete reads, and unknown identities remain coverage gaps. OCR and live Gmail/Edge compatibility are not verified or shipped.

Jev is optional in development. Configure `TYPESAFE_API_KEY` in a private `.env`, then explicitly enable **Send redacted text to Jev**. No key is included in the installer; packaged cloud support needs a separately authorized authenticated backend. No microphone, continuous cloud video, payments, or contact messages are included.

The current detection/release branch evaluates 44 held-out synthetic cases, with separate development fixtures and honest coverage gaps. Windows packaging audits Electron, self-contained observer resources, dependencies and excluded assets before generating an installer. Standard-user installation, signatures/Device Guard compatibility, real Chrome/Edge extraction, and the packaged autonomous flow remain open release gates; a diagnostic directory build is not a usable release.
