// Runs the migration in an in-memory Postgres (PGlite) with minimal stand-ins for Supabase's
// auth schema and roles, then checks the row-level security rules.
// Run: deno run --allow-read --allow-env --allow-net supabase/tests/rls_test.ts
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { pgcrypto } from "npm:@electric-sql/pglite@0.3/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
const migrationDir = new URL("../migrations/", import.meta.url);

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
`);
// Supabase grants table privileges in public to these roles by default.
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
// In filename order, as Supabase applies them.
const migrations = [];
for await (const entry of Deno.readDir(migrationDir)) if (entry.name.endsWith(".sql")) migrations.push(entry.name);
for (const name of migrations.sort()) await db.exec(await Deno.readTextFile(new URL(name, migrationDir)));
await db.exec(await Deno.readTextFile(new URL("../seed.sql", import.meta.url)));

const A = "00000000-0000-0000-0000-00000000000a"; // protected person
const B = "00000000-0000-0000-0000-00000000000b"; // helper
const C = "00000000-0000-0000-0000-00000000000c"; // stranger
for (const [id, name] of [[A, "Ann"], [B, "Ben"], [C, "Cal"]]) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@example.com`, { display_name: name }]);
}

async function as<T>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role;`);
  }
}

let failures = 0;
function expect(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + detail}`);
  if (!ok) failures++;
}
async function expectError(name: string, fn: () => Promise<unknown>) {
  try { await fn(); expect(name, false, "no error"); } catch { expect(name, true); }
}

// Profiles created by trigger.
expect("profile trigger", (await as<{ display_name: string }>(A, `select display_name from profiles`)).length === 1);

// Household: A creates, invites B as helper.
const [{ create_household: hid }] = await as<{ create_household: string }>(A, `select create_household('Ann family', 'protected')`);
const [{ create_household_invite: code }] = await as<{ create_household_invite: string }>(A, `select create_household_invite($1, 'helper')`, [hid]);
expect("invite code format", /^[A-Z2-9]{6}$/.test(code), code);
await as(B, `select join_household($1)`, [code.toLowerCase()]);
await expectError("invite single use", () => as(C, `select join_household($1)`, [code]));
const members = await as<{ role: string }>(B, `select * from my_household_members()`);
expect("helper sees members", members.length === 2);
expect("stranger sees no members", (await as(C, `select * from my_household_members()`)).length === 0);

// Incidents: private until A shares with helpers.
await as(A, `insert into incidents (user_id, platform, surface, risk, evidence_redacted) values ($1, 'ios', 'sms', 'high_risk', 'x')`, [A]);
expect("owner sees incident", (await as(A, `select id from incidents`)).length === 1);
expect("helper blocked before sharing", (await as(B, `select id from incidents`)).length === 0);
await as(A, `update profiles set share_incidents_with_helpers = true where id = $1`, [A]);
expect("helper sees after sharing", (await as(B, `select id from incidents`)).length === 1);
expect("stranger never sees", (await as(C, `select id from incidents`)).length === 0);
await expectError("cannot insert incident for someone else", () =>
  as(C, `insert into incidents (user_id, platform, surface, risk) values ($1, 'ios', 'sms', 'caution')`, [A]));
await expectError("cannot edit incident evidence", () => as(A, `update incidents set evidence_redacted = 'changed'`));
await as(A, `update incidents set user_action = 'reviewed'`);
expect("can set user_action", (await as<{ user_action: string }>(A, `select user_action from incidents`))[0].user_action === "reviewed");
expect("helper cannot change incident", (await as(B, `update incidents set user_action = 'dismissed' returning id`)).length === 0);

// Call screening: lines, screened calls and the family safe word.
await db.query(`insert into screening_lines (e164) values ('+15555550190')`);
const [{ claim_screening_line: line }] = await as<{ claim_screening_line: string }>(A, `select claim_screening_line()`);
expect("claims the free line", line === "+15555550190", line);
expect("same line again", (await as<{ claim_screening_line: string }>(A, `select claim_screening_line()`))[0].claim_screening_line === line);
await expectError("no second free line", () => as(C, `select claim_screening_line()`));
expect("own line visible", (await as(A, `select * from screening_lines`)).length === 1);
expect("others' lines hidden", (await as(B, `select * from screening_lines`)).length === 0);
await db.query(`insert into screened_calls (user_id, conversation_id, risk) values ($1, 'conv_1', 'high_risk')`, [A]);
expect("owner sees screened call", (await as(A, `select id from screened_calls`)).length === 1);
expect("sharing helper sees screened call", (await as(B, `select id from screened_calls`)).length === 1);
expect("stranger never sees screened call", (await as(C, `select id from screened_calls`)).length === 0);
await expectError("clients cannot write screened calls", () =>
  as(A, `insert into screened_calls (user_id, conversation_id, risk) values ($1, 'conv_2', 'clear')`, [A]));
await as(A, `insert into incidents (user_id, platform, surface, risk) values ($1, 'ios', 'call', 'clear')`, [A]);
expect("clear calls are incidents", (await as(A, `select id from incidents where risk = 'clear'`)).length === 1);
await as(A, `delete from incidents where risk = 'clear'`);

expect("no safe word yet", (await as<{ ok: boolean }>(B, `select household_has_safe_word($1) as ok`, [hid]))[0].ok === false);
await as(B, `select set_safe_word($1, '  Blue  Moon! ')`, [hid]);
expect("helper set safe word", (await as<{ ok: boolean }>(A, `select household_has_safe_word($1) as ok`, [hid]))[0].ok === true);
const [{ safe_word_hash: hash }] = (await db.query<{ safe_word_hash: string }>(`select safe_word_hash from households where id = $1`, [hid])).rows;
const [{ expected }] = (await db.query<{ expected: string }>(
  `select encode(extensions.digest($1::text || ':blue moon', 'sha256'), 'hex') as expected`, [hid])).rows;
expect("safe word normalized before hashing", hash === expected);
await expectError("members cannot read the hash", () => as(A, `select safe_word_hash from households`));
expect("members still see the household", (await as(A, `select name from households`)).length === 1);
await expectError("stranger cannot set safe word", () => as(C, `select set_safe_word($1, 'x')`, [hid]));
expect("stranger can't tell", (await as<{ ok: boolean }>(C, `select household_has_safe_word($1) as ok`, [hid]))[0].ok === false);

// Block lists.
await as(A, `insert into blocked_numbers (owner_user_id, e164, source, created_by) values ($1, '+15555550123', 'user', $1)`, [A]);
await as(B, `insert into blocked_numbers (household_id, e164, source, created_by) values ($1, '+15555550124', 'household', $2)`, [hid, B]);
await expectError("stranger cannot add to household", () =>
  as(C, `insert into blocked_numbers (household_id, e164, source, created_by) values ($1, '+15555550125', 'household', $2)`, [hid, C]));
await expectError("cannot fake seed rows", () =>
  as(C, `insert into blocked_numbers (e164, source, created_by) values ('+15555550126', 'seed', $1)`, [C]));
const annList = await as<{ value: string; source: string }>(A, `select * from my_block_list() where kind = 'phone'`);
expect("owner list has own + household + seed", annList.length === 5, JSON.stringify(annList));
const calList = await as<{ value: string }>(C, `select * from my_block_list() where kind = 'phone'`);
expect("stranger list has seed only", calList.length === 3, JSON.stringify(calList));

// Community threshold: 3 distinct reporters.
for (const uid of [A, B]) await as(uid, `insert into reports (reporter_id, kind, value) values ($1, 'phone', '+15555550177')`, [uid]);
expect("2 reports not community", (await as(C, `select * from my_block_list() where source = 'community'`)).length === 0);
await as(C, `insert into reports (reporter_id, kind, value) values ($1, 'phone', '+15555550177')`, [C]);
expect("3 reports community", (await as(C, `select * from my_block_list() where source = 'community'`)).length === 1);
expect("reports private", (await as(C, `select * from reports`)).length === 1);

// Devices and helper view.
await as(A, `insert into devices (user_id, platform, name, apns_token) values ($1, 'windows', 'Ann PC', 'tok')`, [A]);
expect("helper sees device status", (await as(B, `select * from household_devices()`)).length === 1);
expect("helper cannot read device rows", (await as(B, `select * from devices`)).length === 0);

// Service-only tables and functions.
expect("pairing codes hidden", (await as(A, `select * from pairing_codes`)).length === 0);
await expectError("increment_usage not callable", () => as(A, `select increment_usage($1, 1, 0, 0)`, [A]));

// Account deletion cascades.
await as(C, `select delete_my_account()`);
expect("account deleted", (await db.query(`select 1 from auth.users where id = $1`, [C])).rows.length === 0);
expect("reports cascade", (await db.query(`select 1 from reports where reporter_id = $1`, [C])).rows.length === 0);

console.log(failures === 0 ? "\nall RLS checks passed" : `\n${failures} RLS checks failed`);
Deno.exit(failures === 0 ? 0 : 1);
