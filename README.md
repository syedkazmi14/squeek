# squeek

- [Implementation plan](docs/superpowers/plans/2026-10-03-squeek-implementation.md)
- [Design](docs/superpowers/specs/2026-10-03-squeek-scam-protection-design.md)
- [Windows development check](docs/development/windows-observation-check.md)

## Development

The current code is an observation-contract and Windows helper foundation. The Electron interface, automatic monitoring, scam detection, OCR, voice, and installer are planned. Real-browser extraction is not verified.

On Windows x64 with Node.js 24+ and a .NET 10 SDK:

```powershell
npm.cmd ci
npm.cmd run observer:build
npm.cmd test
npm.cmd run typecheck
npm.cmd run observer:probe
```

The default probe performs a paused health check and does not read screen text. Native tests require the observer and policy harness built by `observer:build`. Build products, the local SDK, and dependencies are ignored by Git. Development and verification details are in the Windows development check above.
