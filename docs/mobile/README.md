# Squeek for iPhone

Status: a development build in [apps/ios](../../apps/ios/README.md), with the backend in [supabase/](../../supabase/README.md). This page describes the app as it is now: what each protection does, what iOS allows, and what we can honestly claim. Where it and the code differ, the code wins. It sits alongside the desktop design in [the Squeek scam protection spec](../superpowers/specs/2026-10-03-squeek-scam-protection-design.md) and shares an account and database with it; see [Accounts, database and sync](../backend/README.md).

Goal: a working hackathon demo. It doesn't need to be perfect, but every claim made to judges must match what the build does.

## What it is

Squeek is a calm second opinion for older adults on calls, texts, websites and payments, with a person they trust kept in the loop. It is a native SwiftUI app (`apps/ios`, iOS 26). Most protections are Apple extensions written in Swift. The backend is Supabase (Postgres with row-level security, Auth, Realtime, Edge Functions), shared with the Windows app. The Jev and Safe Browsing keys, the Twilio credentials and the ElevenLabs agent live only in Edge Function secrets, never in the app.

The app has three tabs:

- **Home**: Squeek the mascot greets the person and says what happened since their last visit (a short summary written on the phone from templates, so it is instant, private and never invents anything). Below are the guards, each with its state, and the latest warnings.
- **Activity**: every warning from this iPhone, the person's computer and the people they help, with detail screens. Settings and the block list sit behind buttons.
- **My Person**: the trusted person (a family group underneath), the family safe word, devices and computer pairing.

## The guards

Five guards count toward "5 of 5 on". Setup is one card per guard, shown on first launch and from Home for any guard that is off. Screen Guard is a sixth, optional one.

| Guard | What it does | Mechanism | Limits |
| --- | --- | --- | --- |
| **Calls** | Blocks and labels known scam numbers. Answers calls the person misses, asks who is calling and why, then phones the person with a spoken verdict. | Call Directory extension (CallKit) for the list. For screening, the person's carrier forwards unanswered calls to a Squeek phone line (Twilio), where an ElevenLabs agent answers. After the call, `call-webhook` judges it. | The list only holds numbers already reported. Screening needs a carrier forwarding code, set once in the Phone app, which Squeek can't check. The agent talks to the caller but never decides the verdict. |
| **Texts** | Sends scam texts from unknown senders to Junk. Optionally checks every text and notifies on a likely scam. | Message Filter extension (IdentityLookup, local rules only). The optional extra is a Shortcuts "Message" automation that runs the Screen a Message App Intent. | The filter never sees iMessage or contacts' texts. The automation sees every text, checks it on the phone first, and sends only texts with a link or a warning sign for a closer check. Whether iOS passes the message text to the automation without a prompt is not confirmed on a device. |
| **Websites** | Warns before dangerous links open in Safari and blocks known bad sites in every app. | Safari Web Extension, plus a downloadable encrypted-DNS configuration profile. Any link or message can also be shared to "Check with Squeek". | The extension works in Safari only, and the person enables it in Settings. The DNS profile just fails the load, with no explanation. |
| **Payments** | Pauses the person before they pay after a likely scam. | A Shortcuts automation runs Check Before Paying when a payment or bank app opens. If Squeek caught a likely scam in the last 30 minutes, it shows what happened, a "Call &lt;person&gt; first" button and a 30-second breather. It never blocks the payment. A Live Activity shows the warning on the Lock Screen and in the Dynamic Island meanwhile. | The automation is made by the person in Shortcuts. If they tap "Continue anyway" on a likely scam, their trusted people are phoned. |
| **Your person** | Someone the person trusts can help them check and hears when something looks wrong. | A family group: shared block lists, opt-in warning sharing, invite codes, check-ins, a family safe word. | See Trusted person below. |
| **Screen Guard** (optional) | Reads the text on the screen about every 30 seconds and warns on a likely scam. | A Broadcast Upload Extension the person starts from the system picker. Text recognition and the rule check run on the phone. | The person starts it and iOS shows a red bar while it runs. Not verified on a device yet. |

### What iOS does not allow

No third-party app can listen to a phone call, read other apps' screens, or read notifications. Squeek does not "hear" a scam call on the iPhone itself. What it does instead is answer the calls the person misses: the carrier forwards them to Squeek's line, where the agent talks to the caller. A call the person picks up themselves is not screened. Apple's own Call Screening (iOS 26) handles unknown callers; Squeek adds shared block lists, labels and its spoken verdict on top.

## Call screening in detail

1. The person claims a free Squeek line from the app and sets a carrier forwarding code (conditional forwarding for unanswered calls). They also give an **alert phone**, the number Squeek calls with verdicts.
2. An unanswered call forwards to the Squeek line. The ElevenLabs agent asks who is calling and why, collects a few facts (who they say they are, what they want, a callback number), and if they claim to be family, asks for the family safe word.
3. ElevenLabs sends a signed post-call webhook (HMAC) to `call-webhook`. It works out the verdict with the shared rules and Jev's reading of what the caller said, plus the safe word result. The agent's own opinion never decides.
4. It writes `screened_calls` and an `incidents` row (surface "call"; risk high_risk, caution or clear), then phones the person with a short spoken summary (or texts, if `SQUEEK_ALERT_CHANNEL=sms`). For a likely scam, the person's helpers are also phoned, if the person shares warnings.
5. Activity shows the call with what the caller said, the safe word result and a callback number if they left one.

Hang-ups are not recorded. Audio and transcripts are never stored: only the verdict and a short redacted summary.

## Trusted person

- **Group:** invite as a helper, or as someone to protect, with a single-use code that lasts 24 hours. A helper's block-list entries reach the protected person's call blocker.
- **Sharing is the protected person's choice.** Before they turn on "Share my warnings with helpers", Squeek lists exactly what helpers will and won't see. Helpers see the kind of warning, when it happened, and a short excerpt with private details removed. They never see messages, recordings, transcripts, screenshots or location.
- **Escalation:** if the person taps "Continue anyway" on the payment pause for a likely scam, `notify-helpers` phones their helpers once ("…is about to pay someone after a call that looked like a scam. You might want to call them now."). Practice pauses never send.
- **Check-ins:** a helper taps "Check in on &lt;name&gt;". The person sees it in Home's speech bubble with "I'm OK" and "Please call me", and gets a phone call if they have an alert phone. The helper sees the answer live. Unanswered check-ins lapse after a day.
- **Helper view:** My Person shows the people a helper looks out for, with their shared warnings and Call and Check in buttons. Everyone can add their own phone number there.
- **Family safe word:** a word the agent asks callers who claim to be family. Only a hash is stored, so nobody can read it back.

## Architecture

```
iPhone                                          Supabase                       PC (Electron)
------                                          --------                       -------------
SwiftUI app ── supabase-swift ──────────► Auth, Postgres (RLS), Realtime ◄──── supabase-js
  │  writes caches to App Group                 Edge Functions:
  ├─ Call Directory ext  ◄─ block list            assess-text, check-link, report, pair-device
  ├─ Message Filter ext  ◄─ rules.json            call-webhook (ElevenLabs → verdict → phone call)
  ├─ Share ext ─────────── edge fn calls ──►      notify-helpers, check-in, dns-profile, demo-sign-in
  ├─ Safari Web ext ◄─ block list + check-link
  ├─ Screen Guard ext ── App Group alerts ──► recorded by the app
  ├─ Widgets ext: Live Activity (Dynamic Island)
  └─ DNS profile (system resolver)          Twilio ◄── calls and forwarded calls ──► ElevenLabs agent
```

- The **main app** signs in, subscribes to Realtime, and writes the block list, rules and settings into the **App Group**. The extensions read from there. The Call Directory and Message Filter extensions need no network.
- **Auth sharing:** the Supabase session lives in a Keychain access group shared with the Share and Safari extensions, so they can call Edge Functions.
- **No push on a free account.** A locked phone is reached by Twilio phone calls. While the app runs, Realtime and local notifications cover the rest, and Background App Refresh covers the gaps.
- **Message checks** run on the phone first, then go to `assess-text` (the same rules as the desktop, plus Jev), redacted on the device before sending. **Link checks** go to `check-link` (heuristics, redirect expansion with SSRF limits, Google Safe Browsing). A likely scam the phone finds by itself is recorded too, so it reaches Activity and the payment pause.
- **Shared code:** the `SqueekCore` Swift package holds rules, redaction, link analysis, phone numbers, models and the App Group store. It reads the same `packages/detection/rules/rules.json` as the server, checked against `tests/fixtures/golden.json` on both sides.

## Sync between the PC and iPhone

1. The PC shows a pairing QR code; the signed-in iPhone scans it, so nobody types a password on the PC (`pair-device`).
2. A warning on the PC appears on the iPhone within seconds through Realtime, with category, risk and a short redacted excerpt. No raw email is stored. A recent iPhone warning also counts toward the payment pause.
3. A number reported on the iPhone joins the block list, and the person's helpers get it too.
4. Voice, text size and allow-lists follow the account.

The Windows app doesn't connect to the backend yet. Database details, row-level security and conflict rules: [docs/backend/README.md](../backend/README.md).

## Privacy

- Raw messages, screenshots, screen contents, audio and transcripts are never stored. Incidents keep a category, risk, rule IDs and at most ~280 characters of redacted excerpt, and only if the person keeps a history.
- Screenshots and Screen Guard frames are read on the phone with Vision and discarded. Only redacted text leaves the phone, and only when a check needs the server.
- Phone numbers on block lists are stored as E.164 because CallKit needs exact numbers. They are the person's or family's own data, protected by row-level security.
- Helpers see a protected person's warnings only if that person turned sharing on, and the database enforces it.
- Sign-in is by email only, for testing. That is a deliberate shortcut for the demo, not a production design.

## Design and accessibility

The app is "Calm Glass": warm charcoal and cream with one yellow accent taken from the Squeek mascot, Nunito type, and Apple's own components. Yellow is the only colour that asks for attention; warnings use separate red, orange and green so they never look like branding.

- Dynamic Type up to the largest accessibility sizes, VoiceOver labels, large targets, reduced motion, and no timed dismissal.
- Copy is plain, short and calm, and never scary.
- Squeek never says "safe". An unflagged result reads "No warning signs found" and says what wasn't checked.

## Running it

- **A free Apple account is enough.** The build uses only App Groups and Keychain Sharing. Installs expire after 7 days, and a free team can register about 10 new App IDs per 7 days, which each new extension spends. Re-sign the app the day before a demo.
- **A physical iPhone** is needed for call blocking, text filtering, the QR scanner, the DNS profile, Screen Guard and the Dynamic Island. Use a second phone for test calls and texts, and never real scam numbers.
- **Enable steps the person does once** are walked through in the app: Phone › Call Blocking & Identification, Messages › Unknown & Spam, Safari › Extensions, the DNS profile, the carrier forwarding code, and the Shortcuts automations.
- **Without a server,** checks use local rules and the block list is stored on the phone.
- **Demo mode (debug builds):** launch with `-SqueekDemo` for sample data, `-SqueekTab home|activity|person|settings`, `-SqueekRole helper` to see the app as the trusted person, and `-SqueekCheckIn open|waiting|ok|call_me`.

Setup, signing and the Supabase deploy steps are in [apps/ios/README.md](../../apps/ios/README.md) and [supabase/README.md](../../supabase/README.md).

## Honest claims for judges

Say:

- "Squeek answers the calls you miss, asks the caller who they are, and phones you with what it found."
- "Squeek blocks and labels calls from numbers reported by you, your family or the community."
- "Squeek filters texts from unknown senders, warns on links in Safari and anything you share, and pauses you before paying after a scam."
- "Your trusted person only sees what you choose to share, and Squeek tells you exactly what that is first."
- "The PC and phone share one account; a scam spotted on one shows up on the other."

Don't say:

- "Squeek detects scam calls as they happen." It can't hear calls on the iPhone; it answers the ones you miss.
- "Squeek reads all your messages." The filter sees unknown senders only; the optional automation and Screen Guard are opt-in.
- "Squeek is safe to use for real money." Sign-in is test-only and the app is a development build.

## Not verified yet

These are built but have not been run on a real iPhone. Treat them as unproven in a demo until they have:

- The Message automation: whether iOS hands the text to the App Intent without a prompt.
- Screen Guard: memory use against the extension's ~50 MB limit, and whether the extension can post its own notification (the app does it otherwise, later).
- The Dynamic Island Live Activity and Screen Guard on a device, once the App ID limit allows installing them.
- The live phone calls for helper escalation and check-ins.

## Sources

- [CallKit Call Directory extension](https://developer.apple.com/documentation/callkit/cxcalldirectoryprovider)
- [SMS and MMS message filtering](https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering)
- [Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Broadcast Upload extensions (ReplayKit)](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler)
- [ActivityKit Live Activities](https://developer.apple.com/documentation/activitykit)
- [Google Safe Browsing Lookup API](https://developers.google.com/safe-browsing/v4/lookup-api)
- [supabase-swift](https://github.com/supabase/supabase-swift)
