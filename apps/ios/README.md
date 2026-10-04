# Clickey for iPhone

A development build of Clickey for iPhone (not set up for the App Store). The design is in [docs/mobile/README.md](../../docs/mobile/README.md), and the backend it syncs with is in [supabase/README.md](../../supabase/README.md).

## What's in it

| Feature | Where | Needs |
| --- | --- | --- |
| Check a pasted message, a link, or a screenshot; result read aloud | `Clickey/Views/CheckView.swift` | Works offline with local rules; full check when signed in |
| "Check with Clickey" in the Share sheet (text, links, images) | `ShareExtension/` | Turn on in the Share sheet's app row once |
| Block and label scam callers | `CallDirectoryExtension/` | Settings › Apps › Phone › Call Blocking & Identification |
| Move scam texts from unknown senders to Junk | `MessageFilterExtension/` | Settings › Apps › Messages › Unknown & Spam |
| Warn before dangerous links open in Safari | `SafariExtension/` | Settings › Apps › Safari › Extensions |
| Block known malicious websites in every app (encrypted DNS) | `Clickey/Services/ProtectiveDNS.swift` | Settings › General › VPN & Device Management › DNS |
| Sign in (emailed link or code, or Apple), sync with the PC app | `Clickey/AppModel.swift` | A Supabase project |
| Family group: shared block lists, opt-in warning sharing, invite codes | `Clickey/Views/FamilyView.swift` | Signed in |
| Live warnings from your PC or family, with notifications | Realtime in `AppModel.swift`; push in `supabase/functions/_shared/push.ts` | Notifications allowed; APNs secrets for push when the app is closed |
| Connect the PC by scanning its QR code | `Clickey/Views/PairComputerView.swift` | Signed in; physical iPhone camera |
| Shortcuts actions: Check a Message / Link / Screenshot | `Clickey/Intents/ClickeyIntents.swift` | Optional Back Tap setup (see the in-app guide) |

Shared logic lives in the `ClickeyCore` Swift package: rules, redaction, link analysis, phone numbers, models and the App Group store. The app and every extension use it, and it reads the same `packages/detection/rules/rules.json` as the server.

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
   xcodegen && open Clickey.xcodeproj
   ```

5. **Signing:** select each of the five targets › Signing & Capabilities and make sure your team is selected. If Xcode reports a missing App Group or capability, click its fix button so Xcode registers it with your account.
6. **Run on a physical iPhone.** Call blocking, SMS filtering, the QR scanner and protective DNS can't be tested in the Simulator. The rest of the app runs there.
7. In the app, open **Set up protections** on the Home screen and follow each card.

Skip the Supabase values to run on-device only: checks use local rules, the block list is stored on the phone, and there's no sync.

### Free Apple accounts

A free (Personal Team) account can't sign three of the capabilities in `project.yml`: Sign in with Apple, Push Notifications and Network Extension (DNS settings). To build anyway, delete these three lines from the `Clickey` target's `entitlements` and run `xcodegen` again:

```yaml
aps-environment: development
com.apple.developer.applesignin: [Default]
com.apple.developer.networking.networkextension: [dns-settings]
```

Email sign-in, call blocking, SMS filtering, the Share sheet and Safari still work. Free-account builds expire after 7 days.

## Demo script

1. Sign in on the iPhone. In Supabase, run `seed.sql` so the demo numbers and websites exist.
2. **Message check:** Home › Check a message, and paste: *"This is the IRS. A warrant for your arrest will be issued today. Pay with Google Play gift cards and do not tell anyone."* The result says "This looks like a scam", lists the evidence, and reads it aloud.
3. **Link check:** check `paypal-account-verify.example/login`. The result says "Don't open this link" because it's on the seed block list.
4. **Calls:** replace a seed number in `supabase/seed.sql` with a teammate's phone, re-seed, and turn on call blocking. When the teammate calls, the screen shows "Clickey: reported scam". Turn on "Also block numbers reported by others" and the call is blocked.
5. **Sync:** insert an `incidents` row for your user from the Supabase dashboard, with `platform` set to `windows`. It appears in Warnings within seconds with a "Clickey on your PC" notification. This stands in for the PC app until that exists.
6. **Family:** create a family group, invite a second account, and block a number from either phone. It reaches both phones' call blockers.

## Verification status

Verified with Xcode 27:

- The app and all four extensions build for the iOS Simulator and for a device (unsigned), with no warnings in Clickey's own code.
- The built app bundle has the expected layout: four extensions, the Safari files at the root of their extension, and `rules.json` in each target that needs it.
- In the iPhone Simulator, without a server: the welcome screen, the Home screen, and a message check that flags a scam with evidence and reads it aloud.
- `ClickeyCore` passes all 33 golden checks (`swift run ClickeyChecks`), which are the same fixtures the TypeScript engine passes.

**Not yet verified:** signing with a real team, anything that talks to Supabase (sign-in, sync, Realtime, Edge Functions), and the on-device features: call blocking, SMS filtering, the Share sheet, Safari warnings, protective DNS, the QR scanner and push notifications.

## Regenerating assets

```bash
swift scripts/render-icons.swift
```

This regenerates the app icon and Safari extension icons.
