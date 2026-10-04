# squeek

Home of **Clickey**, a companion that helps older adults notice scams while using their computer or phone. It spots suspicious messages, explains what looks wrong, and speaks the warning out loud.

Status: the iPhone app ([apps/ios](apps/ios/README.md)) and the shared backend ([supabase](supabase/README.md)) are built as development versions. The Windows app is still a design.

## How it works

- **Desktop (Windows, first):** one Electron installer with a bundled C#/.NET helper. The helper reads text from the foreground app through Windows UI Automation, with local OCR as a fallback. Local redaction and rules run first. New content is deduplicated and sent as redacted text to Jev (TypeSafe) for structured assessment. App code decides what to show: a cursor halo, a fixed review panel, and a spoken warning. Warnings in other apps are advisory; only the bundled demo payment page can pause its own action.
- **iPhone:** a native SwiftUI app with Apple extensions. It blocks and labels reported scam callers (Call Directory), filters SMS from unknown senders, warns on dangerous links (Safari extension, protective DNS, link checker), and checks anything shared to it or screenshotted. iOS doesn't let apps listen to calls or read other apps, so those are out of scope.
- **Accounts and sync:** one Supabase backend for both apps. Shared sign-in, incidents, block lists and settings sync live between PC and iPhone, and family helpers can share block lists. The Jev and Safe Browsing keys live only in Edge Functions.

## Planned layout

```
apps/desktop           Electron main/preload, companion, review panel, tray, speech
apps/windows-observer  bundled UI Automation + OCR helper
apps/demo              controlled email/message/payment scenarios
apps/ios               SwiftUI app + Call Directory, Message Filter, Share, Safari, Intents extensions
supabase/              migrations, RLS, seed, Edge Functions (assess-text, check-link, report, ...)
packages/contracts     shared schemas
packages/detection     redaction, rules (JSON, also read by Swift), Jev questions, policy
packages/providers     TypeSafe transport
packages/ui-tokens     shared colors, type, copy
tests/fixtures         synthetic scam / legitimate / adversarial examples
```

## Docs

- [Clickey explained](docs/clickey-explained.md): plain-language overview
- [Desktop design and build proposal](docs/superpowers/specs/2026-10-03-clickey-scam-protection-design.md)
- [iPhone hackathon build plan](docs/mobile/README.md)
- [Accounts, database and sync](docs/backend/README.md)
- [Design concepts](docs/design/): mockups and prompts (v5 "mature" is the current direction)
