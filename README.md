# squeek

Home of **Squeek**, a companion that helps older adults notice scams while using their computer or phone. It spots suspicious messages, explains what looks wrong, and speaks the warning out loud.

Status: the iPhone app ([apps/ios](apps/ios/README.md)) and the shared backend ([supabase](supabase/README.md)) are built as development versions. The Windows app ([apps/desktop](docs/development/desktop.md)) is in active development. In development builds it can sign in to the same account as the iPhone (same email) and send it warnings; packaged builds don't connect yet.

## How it works

- **Desktop (Windows, first):** one Electron installer with a bundled C#/.NET helper. The helper reads text from the foreground app through Windows UI Automation, with local OCR as a fallback. Local redaction and rules run first. New content is deduplicated and sent as redacted text to Jev (TypeSafe) for structured assessment. App code decides what to show: a cursor halo, a fixed review panel, and a spoken warning. Warnings in other apps are advisory; only the bundled demo payment page can pause its own action.
- **iPhone:** a native SwiftUI app with Apple extensions. It blocks and labels reported scam callers (Call Directory), filters SMS from unknown senders, warns on dangerous links (Safari extension, protective DNS, link checker), and checks anything shared to it or screenshotted. iOS doesn't let apps listen to calls or read other apps, so those are out of scope.
- **Accounts and sync:** one Supabase backend for both apps. Shared sign-in, incidents, block lists and settings sync live between PC and iPhone, and family helpers can share block lists. The Jev and Safe Browsing keys live only in Edge Functions.

## Layout

```
apps/desktop           Electron main/preload, companion, review panel, tray, speech
apps/windows-observer  bundled UI Automation + OCR helper
apps/demo              controlled email/message/payment scenarios
apps/ios               SwiftUI app + Call Directory, Message Filter, Share, Safari, Intents extensions
supabase/              migrations, RLS, seed, Edge Functions (assess-text, check-link, report, ...)
packages/contracts     shared schemas
packages/detection     the desktop's assessment pipeline (normalize, signals, policy)
packages/rules         the iPhone and backend rules engine (JSON rules, also read by Swift)
packages/providers     TypeSafe transport
packages/ui-tokens     shared colors, type, copy
tests/fixtures         synthetic scam / legitimate / adversarial examples
```

## Docs

- [Squeek explained](docs/squeek-explained.md): plain-language overview
- [iPhone app and build plan](docs/mobile/README.md)
- [Accounts, database and sync](docs/backend/README.md)
- [Design concepts](docs/design/): mockups and prompts
- [Implementation plan](docs/superpowers/plans/2026-10-03-squeek-implementation.md)
- [Desktop design](docs/superpowers/specs/2026-10-03-squeek-scam-protection-design.md)
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
