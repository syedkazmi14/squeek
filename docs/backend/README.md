# Clickey accounts, database and sync

Status: implemented in [supabase/](../../supabase/README.md) (migration, row-level security tests and Edge Functions) and used by [the iPhone app](../../apps/ios/README.md). The Windows app doesn't connect to it yet. Where this page and the code differ, the code wins. This backend serves both the Windows app ([desktop spec](../superpowers/specs/2026-10-03-clickey-scam-protection-design.md)) and the iPhone app ([iOS plan](../mobile/README.md)).

## Decision: Supabase

One Supabase project provides everything the hackathon needs:

| Need | Supabase piece |
| --- | --- |
| Accounts on PC and iPhone | Auth: email one-time code (both), Sign in with Apple (iPhone) |
| Shared data | Postgres with row-level security (RLS) |
| Live sync between devices | Realtime subscriptions on table changes |
| Keeping the Jev and Safe Browsing keys off devices | Edge Functions (TypeScript/Deno) with secrets |
| Client libraries | `supabase-js` in Electron, `supabase-swift` on iOS |

This replaces the desktop spec's "local developer key" for the prototype: both apps call Edge Functions for assessments. Firebase would also work. Supabase was chosen for SQL, RLS and TypeScript functions that can reuse `packages/detection`.

## Accounts and devices

- **Protected person:** the older adult. Owns their incidents, settings and block lists.
- **Helper:** a family member in the same household. Can see shared incidents and add blocked numbers and domains, if the protected person allows it. Helpers never get control of the protected person's devices.
- **Devices:** each install registers a `devices` row (platform, name, last seen, monitoring status). The account screen lists them, so a helper can see "PC: monitoring paused".
- **Pairing (stretch):** the PC shows a QR code containing a short-lived single-use code. The signed-in iPhone scans it and calls `pair-device`. The function checks the code, then uses the admin API to issue a one-time sign-in token that the PC exchanges for its own session. Baseline fallback: email one-time code on the PC.

## Schema (first migration)

A summary is below; the full definition is [the migration](../../supabase/migrations/20261003000000_init.sql). The migration also has a `household_invites` table (hashed one-time codes), two more profile settings (`history_sync`, `block_reported_numbers`) and a `text` surface for pasted messages.

```sql
profiles            (id uuid pk = auth.users.id, display_name, voice_rate, text_scale,
                     muted bool, share_incidents_with_helpers bool, updated_at)
households          (id, name, created_by)
household_members   (household_id, user_id, role check in ('protected','helper'), pk(household_id,user_id))
devices             (id, user_id, platform check in ('windows','ios'), name, app_version,
                     monitoring_status, last_seen_at)
incidents           (id, user_id, device_id, platform, surface check in
                       ('email','sms','call','link','share','screenshot','browser'),
                     risk check in ('caution','high_risk','unknown'),
                     categories text[], rule_ids text[], evidence_redacted varchar(280),
                     indicator_kind ('domain','phone', null), indicator_value,
                     user_action ('dismissed','reviewed','blocked','reported', null),
                     created_at)                         -- append-only
blocked_numbers     (id, owner_user_id null, household_id null, e164, label,
                     source check in ('user','household','community','seed'), created_by, created_at)
blocked_domains     (same shape as blocked_numbers, with domain instead of e164)
allow_list          (id, user_id, kind ('domain','phone','email'), value, created_at)
reports             (id, reporter_id, kind ('phone','domain'), value, created_at)  -- community input
link_verdicts       (url_hash pk, domain, verdict ('malicious','suspicious','unknown','no_signal'),
                     reasons text[], checked_at, expires_at)   -- written only by Edge Functions
usage_daily         (user_id, day, assessments, link_checks, jev_tokens)  -- quotas
pairing_codes       (code_hash pk, user_id, expires_at, claimed_at)
```

Views:

- `community_blocked_numbers`: numbers with at least N reports from distinct reporters in 30 days (N = 3 for the demo). Shown with the label "reported", never "confirmed".
- `my_blocked_numbers`: the user's own rows, their households' rows, and the community view. This is what the iPhone writes into the Call Directory extension and what the PC shows.

## Row-level security

- `profiles`, `devices`, `allow_list`, `usage_daily`: owner only.
- `incidents`: the owner reads and writes. Helpers in the same household can read only when the owner's `share_incidents_with_helpers` is true. Nobody can update or delete except the owner.
- `blocked_numbers` and `blocked_domains`: readable by the owner and household members. Insertable by the owner or a helper for that household.
- `reports`: insert own; no client reads of other people's rows (only the aggregated view).
- `link_verdicts`, `pairing_codes`: no direct client access; Edge Functions use the service role.
- Add RLS tests (pgTAP or simple SQL scripts) that check a stranger and a non-member helper see nothing.

## Edge Functions

| Function | Called by | Does |
| --- | --- | --- |
| `assess-text` | PC observer, iPhone Share extension and app | Validates and size-limits redacted text, runs `packages/detection` rules plus Jev, applies policy, returns assessment and evidence spans. Writes an `incidents` row if the risk is caution or high and history sync is on. Counts usage |
| `check-link` | iPhone app, Share and Safari extensions, PC when a real destination is exposed | Normalizes the URL, runs heuristics (punycode, lookalikes, IP host, shorteners), expands redirects with SSRF guards, queries Safe Browsing, checks `blocked_domains`, caches in `link_verdicts` |
| `report` | Both apps | Records a phone or domain report, and adds it to the reporter's own block list right away |
| `pair-device` | iPhone (stretch) | Claims a pairing code and issues a one-time sign-in token for the PC |
| `notify-helpers` | Database trigger on a high-risk incident (stretch) | Sends an APNs push to helpers' iPhones |

Shared code: Supabase's CLI can deploy functions that import from outside `supabase/` with the `--use-api` flag. If that doesn't work in practice, copy `packages/detection` into `supabase/functions/_shared` with a build script. [Supabase changelog](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)

Never log request bodies. Enforce per-user quotas from `usage_daily`, a maximum input size, and request deadlines.

## Sync rules

- **Realtime:** both apps subscribe to `incidents`, `blocked_numbers`, `blocked_domains` and their own `profiles` row. RLS also applies to Realtime.
- **Offline:** each app keeps a local cache: the App Group on iPhone, and app data on PC. Incidents created offline are queued and inserted with a client-generated UUID, so retries don't create duplicates.
- **Conflicts:** settings are last-write-wins on `updated_at`. Incidents are append-only. Block lists are add/remove rows, never edits, so there's nothing to merge.
- **iPhone call list:** on any change to `my_blocked_numbers`, rewrite the sorted list into the App Group and reload the Call Directory extension.

## Privacy

- Raw emails, SMS, screenshots and call audio never reach the database. Redaction happens on the device before any Edge Function call.
- Incident history sync is opt-in. Deleting the account deletes its rows (cascade from `auth.users`).
- Phone numbers are stored only as needed for blocking and never shared outside the household, except as aggregated community counts.

## Proposed paths

```
supabase/
  config.toml
  migrations/0001_init.sql        tables, views, RLS
  seed.sql                        test accounts, team-owned test numbers, demo domains
  functions/
    assess-text/  check-link/  report/  pair-device/  notify-helpers/
    _shared/                      (fallback copy of packages/detection if needed)
  tests/                          RLS checks
```

Generate types for both clients: `supabase gen types typescript` for Electron and Edge Functions. Hand-written `Codable` models in `apps/ios/Shared` for Swift, kept in step with the migrations.
