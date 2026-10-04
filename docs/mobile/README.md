# Clickey for iPhone: hackathon build plan

Status: implemented as a development build in [apps/ios](../../apps/ios/README.md), with the backend in [supabase/](../../supabase/README.md). See the app README for what has been verified. The plan below is what the build follows; where they differ, the code wins. It sits alongside the desktop design in [the Clickey scam protection spec](../superpowers/specs/2026-10-03-clickey-scam-protection-design.md) and shares an account system and database with it; see [Accounts, database and sync](../backend/README.md).

Goal: a working hackathon demo. It doesn't need to be perfect, but every claim made to judges must match what the build actually does.

## Summary

- **Native SwiftUI app** in this repo at `apps/ios`. It's iOS-only, and almost every protection is a separate Apple extension written in Swift, so React Native would add friction and little value.
- **The protections iOS actually allows:**
  - **Calls:** a Call Directory extension blocks numbers and shows a "Clickey: reported scam" label on the incoming-call screen, using a blocklist synced from the database.
  - **Text messages:** a Message Filter extension sorts SMS from unknown senders into Junk.
  - **Dangerous links:** a Safari Web Extension warns before scam links open, a protective-DNS toggle blocks known malicious domains in every app, and the user can share any link to Clickey to have it checked.
  - **Anything else:** the Share sheet or a screenshot check. The user sends a message, email or screenshot to Clickey, which reads it, warns and speaks the result.
- **What iOS does not allow:** no third-party app can listen to calls, read other apps' screens, or read notifications. Clickey can't "hear" a scam call while it's happening. Apple's own Call Screening (iOS 26) handles unknown callers; Clickey adds synced, family-shared blocklists and labels on top of it.
- **Sync:** Supabase (Postgres, Auth, Realtime, Edge Functions) is the single backend for both PC and iPhone. The Jev key lives in an Edge Function, never in either app.

## What each protection really does

| Use case | iOS mechanism | Automatic? | What the user sees | Limits |
| --- | --- | --- | --- | --- |
| Scam calls | Call Directory extension (CallKit) | Yes, for numbers on the list | Call blocked silently, or incoming-call screen shows "Clickey: reported scam" | Only numbers already on the list. No audio, no real-time lookup. List refreshes only when the app runs |
| Scam calls, live lookup (stretch) | Live Caller ID Lookup extension (iOS 18+) | Yes | Label from a server lookup | Needs a private-information-retrieval server (Apple has an example service) and registration in the CloudKit Console; forum reports call it flaky. Not for the hackathon unless everything else is done |
| Scam SMS | Message Filter extension (IdentityLookup) | Yes | Message goes to Junk | Unknown senders only; never iMessage or contacts. Use local rules only (server deferral needs your own domain) |
| Dangerous links in Safari | Safari Web Extension (content script that checks the page and marks risky links; native handler) | Yes, once enabled in Settings | Warning page before a flagged link opens; known-bad domains blocked | Safari only; user must enable it in Settings. Approved for iOS only; the desktop "no browser extension" rule still applies on Windows |
| Dangerous links in every app | Protective DNS via a downloadable configuration profile (DNS over HTTPS; `NEDNSSettingsManager` needs a paid account) | Yes | Known malicious sites fail to load | No Clickey explanation, just a failed load. Uses a public filtering resolver, not our own list |
| Link from Messages, Mail or WhatsApp | Share extension: share link to "Check with Clickey" | No, one tap | Verdict sheet with reasons, spoken aloud | User has to think to check |
| Suspicious message or email | Share extension (text) or screenshot check (Vision OCR) | No, one tap | Warning, evidence, speech; synced to the account | Same |
| One-press check | App Intent for Shortcuts, Action button or Back Tap: "Check my screen" | No, one press | Same as above | Needs one-time Shortcut setup |

## Architecture

```
iPhone                                              Supabase                         PC (Electron)
------                                              --------                         -------------
SwiftUI app ── supabase-swift ──────────────► Auth, Postgres (RLS), Realtime ◄──── supabase-js
  │  writes caches to App Group                     Edge Functions:
  ├─ Call Directory ext  ◄─ blocked_numbers.json      assess-text  (rules + Jev)
  ├─ Message Filter ext  ◄─ rules.json                check-link   (Safe Browsing + heuristics)
  ├─ Share ext ─────────── edge fn call ───────►      report, pair-device
  ├─ Safari Web ext ◄─ blocked_domains + check-link
  └─ DNS settings (system DoH resolver)
```

- The **main app** signs in, subscribes to Realtime changes, and writes the latest blocklists, rules and settings into the **App Group** shared container. The extensions read from there.
- **Auth token sharing:** store the Supabase session in a Keychain access group shared with the Share and Safari extensions so they can call Edge Functions. The Call Directory and Message Filter extensions don't need network access.
- **Refreshing the call blocklist:** after a sync, the app writes `blocked_numbers.json` (sorted E.164 numbers, which CallKit requires) and calls `CXCallDirectoryManager.reloadExtension`. iOS only runs this when the app runs, so also refresh on Background App Refresh. A silent push is a stretch goal.
- **Message checks** go to the `assess-text` Edge Function, which runs the same `packages/detection` rules and Jev questions that desktop uses. Redact on-device first: phone numbers, emails, card and account numbers, and codes.
- **Link checks** go to `check-link`. It normalizes the URL and flags punycode, lookalike domains, raw IP addresses and known URL shorteners. It expands redirects server-side (with hop, time and private-IP limits to prevent server-side request forgery) and queries Google Safe Browsing. Verdicts are cached in `link_verdicts`. Jev is used only when there is surrounding message text.
- **Speech:** `AVSpeechSynthesizer`, spoken once per incident, with replay, mute and a text equivalent, the same as desktop.

## Sync between PC and iPhone (what the demo shows)

1. The user signs in on the iPhone with an emailed link or one-time code. The PC shows a QR code; the phone scans it to pair, so no one types a password on the PC.
2. The PC flags a scam email. An `incidents` row appears on the iPhone within seconds through Realtime, with category, risk and short redacted evidence. No raw email is stored.
3. On the iPhone, the user reports a scam caller's number. It's added to `blocked_numbers`; the PC shows it in its history; family helpers in the same household get it on their phones too.
4. Settings (voice, text size, mute) and allow-lists follow the account to both devices.

Database details, row-level security and conflict rules: [docs/backend/README.md](../backend/README.md).

## Proposed paths

```
apps/ios/
  Clickey.xcodeproj
  Clickey/                 SwiftUI app: onboarding, sign-in, pairing scanner, home, incident
                           history, report number, link checker, settings, speech
  CallDirectoryExtension/  CXCallDirectoryProvider reading App Group blocklist
  MessageFilterExtension/  ILMessageFilterQueryHandling with local rules.json
  ShareExtension/          SwiftUI sheet, Vision OCR, assess-text / check-link
  SafariExtension/         manifest v3, content script, declarativeNetRequest rules, native handler
  Clickey/Intents/         App Intents: Check a Message / Link / Screenshot (in the app target)
  ClickeyCore/             Swift package: models, redaction, rule interpreter for rules.json,
                           link heuristics, App Group store (builds and tests on macOS)
  Shared/                  Supabase client, check service, speech, OCR, result screen
supabase/                  migrations, RLS policies, seed, Edge Functions (shared with desktop)
packages/detection/rules/  JSON rules + redaction patterns, used by TS (desktop, Edge Functions) and Swift
tests/fixtures/            golden cases run against both the TS and Swift rule interpreters
```

The app stays in the same repository because the database schema, Edge Functions, rules and fixtures are shared contracts between PC and iPhone. An Xcode project in a subfolder costs nothing. Use Swift Package Manager for `supabase-swift`.

## Hackathon scope

Build in this order and stop wherever time runs out. Each step works as its own demo.

| # | Feature | Why | Effort |
| --- | --- | --- | --- |
| 1 | Supabase project, schema, sign-in on iPhone and PC, Realtime incidents list | The PC↔phone sync demo | Medium |
| 2 | Share extension + `assess-text` + speech | Core "is this a scam?" moment on the phone | Medium |
| 3 | Link checker (`check-link`) in the app and Share extension | Covers dangerous links | Small |
| 4 | Call Directory extension + "Report this number" + family-shared blocklist | Call protection that actually runs on incoming calls | Medium |
| 5 | Protective DNS toggle | Cheap system-wide link blocking | Small |
| 6 | Message Filter extension (local rules only) | Automatic SMS protection | Small–medium |
| 7 | Safari Web Extension | Automatic link warnings in Safari | Medium |
| 8 | QR pairing, App Intent, background-refresh alerts to family helpers | Polish | Stretch |
| — | Live Caller ID Lookup, server-deferred SMS filtering | Real-time lookups | Post-hackathon |

## Practical requirements

- **A free Apple account is enough.** The build avoids the paid-only capabilities (push, Sign in with Apple, Network Extension); see `apps/ios/README.md`.
- **A physical iPhone.** The Call Directory and Message Filter extensions can't be meaningfully tested in the Simulator. Use a second team phone to place test calls and send SMS. Never use real scam numbers; seed the blocklist with team-owned numbers, labeled as test data.
- **Enable steps the user must do once:** Settings → Phone → Call Blocking & Identification → Clickey; Settings → Messages → Unknown & Spam → Clickey; Settings → Safari → Extensions → Clickey; approve the DNS profile. Onboarding should walk through each, with large text and one step per screen.
- **Seed data:** the FTC publishes reported Do Not Call complaint data; consider a small seed of reported numbers, after checking its terms. Label community and seed data as "reported", not "confirmed scam".

## UX and accessibility

- Use the v5 "mature" direction: ivory, forest green, ochre, humanist sans-serif, flat large controls. Share color and type tokens with desktop.
- Dynamic Type up to the largest accessibility sizes, VoiceOver labels, 44 pt minimum targets (bigger for primary actions), reduced motion, and no timed dismissal.
- Plain button labels that say what they do: "Block this number", "Don't open link", "Open anyway", "Show family". Warning wording still needs team approval, as on desktop.
- Never say "safe". An unflagged result reads as "No warning signs found", and states what wasn't checked.

## Privacy

- Raw messages, screenshots and call details are never stored in the database. Incidents keep a category, risk level, rule IDs and at most ~280 characters of redacted evidence, only if the user has turned on history sync.
- Phone numbers on block lists are stored as E.164 numbers because CallKit needs exact numbers. They're the user's or household's own data, protected by row-level security.
- Screenshots are processed on-device with Vision and discarded. Only redacted text leaves the phone.
- The Jev and Safe Browsing keys live only in Edge Function secrets.

## Honest claims for judges

- "Clickey blocks and labels calls from numbers reported by you, your family or the community." Not: "Clickey detects scam calls."
- "Clickey filters SMS from unknown senders and warns on links in Safari and anything you share." Not: "Clickey reads all your messages."
- "The PC and phone share one account; a scam spotted on one shows up on the other."

## Sources

- [CallKit Call Directory extension](https://developer.apple.com/documentation/callkit/cxcalldirectoryprovider)
- [Live Caller ID Lookup](https://developer.apple.com/documentation/identitylookup)
- [SMS and MMS message filtering](https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering)
- [NEDNSSettingsManager](https://developer.apple.com/documentation/networkextension/nednssettingsmanager)
- [Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Google Safe Browsing Lookup API](https://developers.google.com/safe-browsing/v4/lookup-api)
- [supabase-swift](https://github.com/supabase/supabase-swift)
