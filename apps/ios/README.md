# Squeek for iPhone

A development build of Squeek for iPhone (not set up for the App Store). The design is in [docs/mobile/README.md](../../docs/mobile/README.md), and the backend it syncs with is in [supabase/README.md](../../supabase/README.md).

## What's in it

| Feature | Where | Needs |
| --- | --- | --- |
| Home: the four guards (calls, texts, websites, your person) and what's still off | `Squeek/Views/HomeView.swift`, `Squeek/Views/GuardSetupView.swift` | Setup opens on first launch |
| "Check with Squeek" in the Share sheet (text, links, images): the manual fallback | `ShareExtension/` | Turn on in the Share sheet's app row once |
| Block and label scam callers | `CallDirectoryExtension/` | Settings › Apps › Phone › Call Blocking & Identification |
| Squeek answers calls you miss and calls you back with the verdict (forwarded to a Twilio line, answered by an ElevenLabs agent, judged by `supabase/functions/call-webhook`) | `Squeek/Views/CallScreeningSetup.swift`, details in `ActivityView.swift` | Signed in; a carrier forwarding code; see `supabase/README.md` › Call screening |
| Payment pause: a Shortcuts automation runs Check Before Paying when a payment or bank app opens; within 30 minutes of a likely scam, Squeek shows what happened, a call-your-person button and a 30-second breather. The Live Activity shows the warning meanwhile | `Squeek/Intents/PaymentIntents.swift`, `Squeek/Views/PaymentPauseView.swift`, `SqueekWidgets/` | A personal automation in Shortcuts (steps in setup) |
| Family safe word that callers claiming to be family are asked for | `Squeek/Views/MyPersonView.swift` | In a group |
| Move scam texts from unknown senders to Junk | `MessageFilterExtension/` | Settings › Apps › Messages › Unknown & Spam |
| Warn before dangerous links open in Safari | `SafariExtension/` | Settings › Apps › Safari › Extensions |
| Block known malicious websites in every app (encrypted DNS) | A configuration profile served by `supabase/functions/dns-profile`, installed from setup | Settings › Profile Downloaded › Install |
| Sign in with just an email (test accounts, no password or verification), sync with the PC app | `Squeek/AppModel.swift`, `supabase/functions/demo-sign-in` | A Supabase project, with `SQUEEK_DEMO_SIGN_IN_DOMAINS=*` |
| Trusted person (a family group underneath): shared block lists, opt-in warning sharing, invite codes | `Squeek/Views/MyPersonView.swift` | Signed in |
| Live warnings from your PC or family, with notifications | Realtime while the app is open; Background App Refresh when it's closed (`AppModel.backgroundRefresh`) | Notifications allowed |
| Connect the PC by scanning its QR code | `Squeek/Views/PairComputerView.swift` | Signed in; physical iPhone camera |

Shared logic lives in the `SqueekCore` Swift package: rules, redaction, link analysis, phone numbers, models and the App Group store. The app and every extension use it, and it reads the same `packages/rules/rules/rules.json` as the server.

## Setup

1. **Install Xcode** from the Mac App Store and open it once to install the iOS platform.
2. **Install XcodeGen**, which generates the Xcode project from `project.yml`:

   ```bash
   brew install xcodegen
   ```

3. **Create your local config** and fill in your Team ID, a bundle id you own, and your Supabase host and anon key (Supabase dashboard › Project Settings › API):

   ```bash
   cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig
   ```

4. **Generate and open the project:**

   ```bash
   xcodegen && open Squeek.xcodeproj
   ```

5. **Signing:** select each of the five targets › Signing & Capabilities and make sure your team is selected. If Xcode reports a missing App Group or capability, click its fix button so Xcode registers it with your account.
6. **Run on a physical iPhone.** Call blocking, SMS filtering, the QR scanner and the DNS profile can't be tested in the Simulator. The rest of the app runs there.
7. In the app, open **Set up protections** on the Home screen and follow each card.

Skip the Supabase values to run on-device only: checks use local rules, the block list is stored on the phone, and there's no sync.

### Free Apple accounts

Everything works on a free Personal Team. The app uses only App Groups and Keychain Sharing, the two capabilities free teams can sign. Instead of the paid-only ones:
- **Sign in:** email link or code (no Sign in with Apple).
- **Website blocking:** a downloadable DNS configuration profile (no Network Extension).
- **Family alerts when Squeek is closed:** Background App Refresh (no push notifications).

Free-team installs expire after 7 days, and the iPhone must be connected to the Mac the first time so Xcode can register it.

### Reviewing screens without an account

Debug builds accept launch arguments (Xcode › Product › Scheme › Edit Scheme › Arguments) that fill the app with sample data for screenshots. Release builds don't include them.
- `-SqueekDemo YES`: sample warnings, block list and trusted person. Give it a value; a bare flag at the end of the arguments can be dropped.
- `-SqueekTab activity`: open a tab (`activity` or `person`), or `settings` to open Settings.

## Demo script

1. Sign in on the iPhone. In Supabase, run `seed.sql` so the demo numbers and websites exist.
2. **Message check:** in Notes, select *"This is the IRS. A warrant for your arrest will be issued today. Pay with Google Play gift cards and do not tell anyone."*, then Share › Check with Squeek. The result says "This looks like a scam", lists the evidence, and reads it aloud.
3. **Link check:** share `paypal-account-verify.example/login` to Squeek the same way. The result says "Don't open this link" because it's on the seed block list.
4. **Calls:** replace a seed number in `supabase/seed.sql` with a teammate's phone, re-seed, and turn on call blocking. When the teammate calls, the screen shows "Squeek: reported scam". Turn on "Also block numbers reported by others" and the call is blocked.
5. **Sync:** insert an `incidents` row for your user from the Supabase dashboard, with `platform` set to `windows`. It appears in Activity within seconds with a "Squeek on your PC" notification. This stands in for the PC app until that exists.
6. **Trusted person:** in My Person, get an invite code, join from a second account, and block a number from either phone. It reaches both phones' call blockers.

## Verification status

Verified with Xcode 27:

- The app and all four extensions build for the iOS Simulator and for a device (unsigned), with no warnings in Squeek's own code.
- The built app bundle has the expected layout: four extensions, the Safari files at the root of their extension, and `rules.json` in each target that needs it.
- In the iPhone Simulator, without a server: the welcome screen, the Home screen, and a message check that flags a scam with evidence and reads it aloud.
- `SqueekCore` passes all 33 golden checks (`swift run SqueekChecks`), which are the same fixtures the TypeScript engine passes.

**Not yet verified:** signing with a real team, anything that talks to Supabase (sign-in, sync, Realtime, Edge Functions), and the on-device features: call blocking, SMS filtering, the Share sheet, Safari warnings, protective DNS, the QR scanner and push notifications.

## Regenerating assets

```bash
swift scripts/render-icons.swift
```

This regenerates the app icon and Safari extension icons.
