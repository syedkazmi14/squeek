# Squeek backend (Supabase)

One Supabase project serves the iPhone app and the Windows app: accounts, the shared database, live sync, and the Edge Functions that hold the Jev and Safe Browsing keys. The design is in [docs/backend/README.md](../docs/backend/README.md).

| Path | What it is |
| --- | --- |
| `migrations/20261003000000_init.sql` | Tables, row-level security, RPCs and the Realtime publication |
| `seed.sql` | Demo websites (`.example`) and fictional phone numbers |
| `functions/assess-text` | Checks a message: redaction, shared rules, links, then Jev |
| `functions/check-link` | Checks a link: heuristics, block lists, redirect expansion, Safe Browsing |
| `functions/report` | Reports a number or website and adds it to your (or your family's) block list |
| `functions/pair-device` | QR pairing so the PC signs in without typing a password |
| `functions/dns-profile` | Serves the iPhone configuration profile for Cloudflare's malware-blocking DNS |
| `functions/_shared/detection` | Copy of `packages/detection`. Refresh it with `scripts/sync-detection.sh` |
| `tests/rls_test.ts` | Runs the migration in an in-memory Postgres and checks the access rules |

## Deploy

1. Create a project at supabase.com, then link this repo to it:

   ```bash
   brew install supabase/tap/supabase
   ```

   ```bash
   supabase login
   ```

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

2. Create the database. This needs outbound access to Postgres ports 5432/6543, which some venue and campus networks block; use a phone hotspot if it times out:

   ```bash
   supabase db push --include-seed
   ```

   For the demo data, paste `seed.sql` into the dashboard's SQL editor.

3. Deploy the functions:

   ```bash
   scripts/sync-detection.sh && supabase functions deploy
   ```

4. Set the secrets. All are optional; without them, the related check reports itself as unavailable or disabled.

   ```bash
   supabase secrets set JEV_API_KEY=... GOOGLE_SAFE_BROWSING_KEY=...
   ```

   `SQUEEK_DAILY_ASSESSMENTS` and `SQUEEK_DAILY_LINK_CHECKS` change the per-user daily limits (defaults 300 and 1000).

5. Push the auth settings (the 6-digit code length, and the `squeek://login-callback` redirect the iPhone uses for emailed sign-in links):

   ```bash
   supabase config push
   ```

   Free projects can't edit email templates without your own SMTP provider, so the default emails contain a sign-in **link**. Tapping it on the iPhone opens Squeek and signs in. To get 6-digit codes instead, add custom SMTP (Authentication › Emails), then add `{{ .Token }}` to the Magic Link and Confirm signup templates. The apps accept either.
6. **Authentication › Providers › Apple** (optional): enable it, and add your iOS bundle id under Client IDs.

## Test locally

```bash
deno test --allow-read packages/detection/test
```

```bash
deno run --allow-read --allow-env --allow-net --allow-write supabase/tests/rls_test.ts
```

```bash
cd supabase/functions && deno check */index.ts
```

The RLS test uses stand-ins for Supabase's `auth` schema and roles, so also try the flows against a real project before relying on them.

## API

All functions take POST JSON with the signed-in user's token (supabase-js and supabase-swift send it automatically). `assess-text` and `check-link` return the same `CheckResult` shape:

```json
{ "kind": "text", "level": "danger", "headline": "This looks like a scam", "speech": "…",
  "reasons": [{ "id": "gift_card", "label": "Asks for payment with gift cards", "excerpt": "…", "source": "rule" }],
  "links": [], "checks": { "ai": "used" }, "incidentId": "…", "rulesVersion": "2026.10.03-1", "isLocal": false }
```

- `assess-text`: `{ text, surface, platform, deviceId? }`. `surface` is one of `email`, `sms`, `call`, `link`, `share`, `screenshot`, `browser`, `text`, and `platform` is `windows` or `ios`. Clients should redact before sending; the server redacts again and stores only an excerpt with private details removed.
- `check-link`: `{ url, surface?, platform?, deviceId? }`.
- `report`: `{ kind: "phone" | "domain", value, label?, householdId?, deviceId? }`.
- `pair-device`: `{ action: "create" }` from the PC returns `{ code, qr, pollSecret }`. The iPhone sends `{ action: "claim", code }`. The PC then polls `{ action: "poll", pollSecret }` until it gets `{ status: "ready", tokenHash }`, and calls `supabase.auth.verifyOtp({ token_hash, type: "email" })`.

The Windows app should use the same RPCs as the iPhone: `my_block_list`, `my_household_members` and `household_devices`. It should also subscribe to Realtime on `incidents`, `blocked_numbers` and `blocked_domains`.
