-- Squeek: shared database for the Windows app and the iPhone app.
-- Raw messages, screenshots and call audio are never stored here. See docs/backend/README.md.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  voice_rate real not null default 0.45 check (voice_rate between 0.1 and 1.0),
  text_scale real not null default 1.0 check (text_scale between 0.8 and 2.0),
  muted boolean not null default false,
  history_sync boolean not null default true,
  share_incidents_with_helpers boolean not null default false,
  block_reported_numbers boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('protected', 'helper')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  code_hash text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('protected', 'helper')),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('windows', 'ios')),
  name text check (char_length(name) <= 100),
  app_version text check (char_length(app_version) <= 40),
  monitoring_status text check (char_length(monitoring_status) <= 40),
  apns_token text check (char_length(apns_token) <= 200),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  platform text not null check (platform in ('windows', 'ios')),
  surface text not null check (surface in ('email', 'sms', 'call', 'link', 'share', 'screenshot', 'browser', 'text')),
  risk text not null check (risk in ('caution', 'high_risk', 'unknown')),
  categories text[] not null default '{}',
  rule_ids text[] not null default '{}',
  evidence_redacted varchar(280),
  indicator_kind text check (indicator_kind in ('domain', 'phone')),
  indicator_value text check (char_length(indicator_value) <= 255),
  user_action text check (user_action in ('dismissed', 'reviewed', 'blocked', 'reported', 'opened_anyway')),
  created_at timestamptz not null default now()
);
create index incidents_user_created_idx on public.incidents (user_id, created_at desc);

create table public.blocked_numbers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label text check (char_length(label) <= 60),
  source text not null check (source in ('user', 'household', 'community', 'seed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(owner_user_id, household_id) <= 1)
);
create unique index blocked_numbers_owner_uq on public.blocked_numbers (owner_user_id, e164) where owner_user_id is not null;
create unique index blocked_numbers_household_uq on public.blocked_numbers (household_id, e164) where household_id is not null;
create unique index blocked_numbers_global_uq on public.blocked_numbers (e164) where owner_user_id is null and household_id is null;

create table public.blocked_domains (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  domain text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  label text check (char_length(label) <= 60),
  source text not null check (source in ('user', 'household', 'community', 'seed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(owner_user_id, household_id) <= 1)
);
create unique index blocked_domains_owner_uq on public.blocked_domains (owner_user_id, domain) where owner_user_id is not null;
create unique index blocked_domains_household_uq on public.blocked_domains (household_id, domain) where household_id is not null;
create unique index blocked_domains_global_uq on public.blocked_domains (domain) where owner_user_id is null and household_id is null;

create table public.allow_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('domain', 'phone', 'email')),
  value text not null check (char_length(value) <= 255),
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

-- Community input. Clients never read other people's rows; only aggregated counts are exposed.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('phone', 'domain')),
  value text not null check (char_length(value) <= 255),
  created_at timestamptz not null default now(),
  unique (reporter_id, kind, value)
);

-- Written only by Edge Functions (service role).
create table public.link_verdicts (
  url_hash text primary key,
  domain text,
  verdict text not null check (verdict in ('malicious', 'suspicious', 'no_signal', 'unknown')),
  result jsonb not null,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  assessments integer not null default 0,
  link_checks integer not null default 0,
  jev_tokens integer not null default 0,
  primary key (user_id, day)
);

create table public.pairing_codes (
  code_hash text primary key,
  poll_hash text not null unique,
  user_id uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

create function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create function public.shares_household_with(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid() and them.user_id = target
  );
$$;

-- True when the caller is a helper in a household where `target` is a protected member who shares incidents.
create function public.can_view_incidents_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    join public.profiles p on p.id = them.user_id
    where me.user_id = auth.uid() and me.role = 'helper'
      and them.user_id = target and them.role = 'protected'
      and p.share_incidents_with_helpers
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.devices enable row level security;
alter table public.incidents enable row level security;
alter table public.blocked_numbers enable row level security;
alter table public.blocked_domains enable row level security;
alter table public.allow_list enable row level security;
alter table public.reports enable row level security;
alter table public.link_verdicts enable row level security;
alter table public.usage_daily enable row level security;
alter table public.pairing_codes enable row level security;
-- household_invites, link_verdicts, usage_daily, pairing_codes: no policies, so only the service role
-- and security-definer functions can touch them.

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));
create policy members_leave on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()));

create policy devices_own on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy incidents_select on public.incidents for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_incidents_of(user_id));
create policy incidents_insert on public.incidents for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy incidents_update on public.incidents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy incidents_delete on public.incidents for delete to authenticated
  using (user_id = (select auth.uid()));
-- Clients may only change what the person did about an incident.
revoke update on public.incidents from anon, authenticated;
grant update (user_action) on public.incidents to authenticated;

create policy blocked_numbers_select on public.blocked_numbers for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
    or (owner_user_id is null and household_id is null)
  );
create policy blocked_numbers_insert on public.blocked_numbers for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      (owner_user_id = (select auth.uid()) and household_id is null and source = 'user')
      or (owner_user_id is null and household_id is not null and source = 'household'
          and public.is_household_member(household_id))
    )
  );
create policy blocked_numbers_delete on public.blocked_numbers for delete to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

create policy blocked_domains_select on public.blocked_domains for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
    or (owner_user_id is null and household_id is null)
  );
create policy blocked_domains_insert on public.blocked_domains for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      (owner_user_id = (select auth.uid()) and household_id is null and source = 'user')
      or (owner_user_id is null and household_id is not null and source = 'household'
          and public.is_household_member(household_id))
    )
  );
create policy blocked_domains_delete on public.blocked_domains for delete to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (household_id is not null and public.is_household_member(household_id))
  );

create policy allow_list_own on public.allow_list for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy reports_select_own on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPCs called by the apps
-- ---------------------------------------------------------------------------

-- Everything the caller should block or label: own, household, seed, and community-reported values.
-- Community values need reports from at least 3 different people in the last 30 days.
create function public.my_block_list()
returns table (entry_id uuid, kind text, value text, label text, source text, household_id uuid)
language sql stable security definer set search_path = '' as $$
  select b.id, 'phone', b.e164, b.label,
         case when b.household_id is not null then 'household' else b.source end, b.household_id
  from public.blocked_numbers b
  where b.owner_user_id = auth.uid()
     or (b.household_id is not null and public.is_household_member(b.household_id))
     or (b.owner_user_id is null and b.household_id is null)
  union all
  select d.id, 'domain', d.domain, d.label,
         case when d.household_id is not null then 'household' else d.source end, d.household_id
  from public.blocked_domains d
  where d.owner_user_id = auth.uid()
     or (d.household_id is not null and public.is_household_member(d.household_id))
     or (d.owner_user_id is null and d.household_id is null)
  union all
  select null::uuid, r.kind, r.value,
         'Reported by ' || count(distinct r.reporter_id) || ' people', 'community', null::uuid
  from public.reports r
  where r.created_at > now() - interval '30 days'
  group by r.kind, r.value
  having count(distinct r.reporter_id) >= 3;
$$;

create function public.create_household(p_name text, p_role text default 'protected')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_role not in ('protected', 'helper') then raise exception 'invalid role'; end if;
  insert into public.households (name, created_by) values (p_name, auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), p_role);
  return hid;
end;
$$;

-- Returns a 6-character code valid for 24 hours. Only its hash is stored.
create function public.create_household_invite(p_household_id uuid, p_role text default 'helper')
returns text language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  bytes bytea := extensions.gen_random_bytes(6);
begin
  if not public.is_household_member(p_household_id) then raise exception 'not a member'; end if;
  if p_role not in ('protected', 'helper') then raise exception 'invalid role'; end if;
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  insert into public.household_invites (code_hash, household_id, role, created_by, expires_at)
  values (encode(extensions.digest(code, 'sha256'), 'hex'), p_household_id, p_role, auth.uid(), now() + interval '24 hours');
  return code;
end;
$$;

create function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv public.household_invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.household_invites
  where code_hash = encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invite code is invalid or expired'; end if;
  insert into public.household_members (household_id, user_id, role)
  values (inv.household_id, auth.uid(), inv.role)
  on conflict (household_id, user_id) do update set role = excluded.role;
  update public.household_invites set used_by = auth.uid(), used_at = now() where code_hash = inv.code_hash;
  return inv.household_id;
end;
$$;

create function public.my_household_members()
returns table (household_id uuid, household_name text, user_id uuid, role text, display_name text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, m.user_id, m.role, p.display_name, m.user_id = auth.uid()
  from public.household_members mine
  join public.households h on h.id = mine.household_id
  join public.household_members m on m.household_id = h.id
  left join public.profiles p on p.id = m.user_id
  where mine.user_id = auth.uid()
  order by h.name, m.role desc, p.display_name;
$$;

-- Lets helpers see whether a protected person's devices are monitoring. No push tokens are returned.
create function public.household_devices()
returns table (user_id uuid, display_name text, platform text, name text, monitoring_status text, last_seen_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.user_id, p.display_name, d.platform, d.name, d.monitoring_status, d.last_seen_at
  from public.household_members me
  join public.household_members them on them.household_id = me.household_id and them.role = 'protected'
  join public.devices d on d.user_id = them.user_id
  left join public.profiles p on p.id = d.user_id
  where me.user_id = auth.uid() and me.role = 'helper' and them.user_id <> auth.uid()
  order by d.last_seen_at desc;
$$;

create function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Service-role only: per-user daily counters used for quotas.
create function public.increment_usage(p_user uuid, p_assessments int, p_link_checks int, p_tokens int)
returns public.usage_daily language sql security definer set search_path = '' as $$
  insert into public.usage_daily (user_id, day, assessments, link_checks, jev_tokens)
  values (p_user, current_date, p_assessments, p_link_checks, p_tokens)
  on conflict (user_id, day) do update set
    assessments = public.usage_daily.assessments + excluded.assessments,
    link_checks = public.usage_daily.link_checks + excluded.link_checks,
    jev_tokens = public.usage_daily.jev_tokens + excluded.jev_tokens
  returning *;
$$;

revoke execute on function public.increment_usage(uuid, int, int, int) from public, anon, authenticated;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.my_block_list() from public, anon;
revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.create_household_invite(uuid, text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.my_household_members() from public, anon;
revoke execute on function public.household_devices() from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime: both apps subscribe to these. RLS still decides which rows each person receives.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.incidents, public.blocked_numbers, public.blocked_domains, public.profiles, public.household_members;
