-- Call screening. Calls the person doesn't answer are forwarded by their carrier to a Squeek phone
-- line, where the ElevenLabs agent asks who's calling and why. After the call, call-webhook turns
-- the answers into a verdict and tells the person (and their trusted person if it looks like a
-- scam). No audio or transcript is stored here: only the verdict and a short redacted summary.

-- Where verdicts are sent as a call or text, for the person and for helpers.
alter table public.profiles add column alert_phone text check (alert_phone ~ '^\+[1-9][0-9]{7,14}$');

-- The family safe word that callers claiming to be family are asked for. Only a hash is kept,
-- set with set_safe_word(); members can't read it back.
alter table public.households add column safe_word_hash text;
revoke select on public.households from anon, authenticated;
grant select (id, name, created_by, created_at) on public.households to authenticated;

-- A genuine caller Squeek took a message from is recorded as 'clear'.
alter table public.incidents drop constraint incidents_risk_check;
alter table public.incidents add constraint incidents_risk_check
  check (risk in ('caution', 'high_risk', 'unknown', 'clear'));

-- Squeek's phone lines, added by the service role. Each is given to one person by claim_screening_line().
create table public.screening_lines (
  e164 text primary key check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid unique references auth.users (id) on delete set null,
  assigned_at timestamptz
);

create table public.screened_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id text not null unique check (char_length(conversation_id) <= 100),
  caller_e164 text check (char_length(caller_e164) <= 20),
  duration_secs integer,
  risk text not null check (risk in ('high_risk', 'caution', 'clear', 'unknown')),
  categories text[] not null default '{}',
  -- Who the caller said they were and what they wanted, as the agent summarized it, redacted.
  caller_claims varchar(120),
  caller_wants varchar(280),
  callback_e164 text check (char_length(callback_e164) <= 20),
  -- Null when the caller didn't claim to be family.
  safe_word text check (safe_word in ('matched', 'wrong', 'not_given', 'not_set')),
  incident_id uuid references public.incidents (id) on delete set null,
  alerted_at timestamptz,
  created_at timestamptz not null default now()
);
create index screened_calls_user_created_idx on public.screened_calls (user_id, created_at desc);

alter table public.screening_lines enable row level security;
alter table public.screened_calls enable row level security;

create policy screening_lines_own on public.screening_lines for select to authenticated
  using (user_id = (select auth.uid()));

-- Helpers see screened calls on the same terms as incidents.
create policy screened_calls_select on public.screened_calls for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_incidents_of(user_id));
create policy screened_calls_delete on public.screened_calls for delete to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update on public.screened_calls from anon, authenticated;

-- Returns the caller's Squeek line, giving them a free one the first time.
create function public.claim_screening_line()
returns text language plpgsql security definer set search_path = '' as $$
declare
  line text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select e164 into line from public.screening_lines where user_id = auth.uid();
  if found then return line; end if;
  update public.screening_lines set user_id = auth.uid(), assigned_at = now()
  where e164 = (
    select e164 from public.screening_lines where user_id is null order by e164 limit 1 for update skip locked
  )
  returning e164 into line;
  if line is null then raise exception 'no Squeek phone line is free'; end if;
  return line;
end;
$$;

-- Lower case, letters, digits and single spaces: "Blue  Moon!" and "blue moon" match.
-- call-webhook normalizes the same way (_shared/calls.ts, normalizeSafeWord).
create function public.normalize_safe_word(p_word text)
returns text language sql immutable set search_path = '' as $$
  select lower(trim(regexp_replace(regexp_replace(coalesce(p_word, ''), '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g')));
$$;

-- Sets or clears (empty word) the family safe word. Any member can change it.
create function public.set_safe_word(p_household_id uuid, p_word text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  word text := public.normalize_safe_word(p_word);
begin
  if not public.is_household_member(p_household_id) then raise exception 'not a member'; end if;
  update public.households
  set safe_word_hash = case
    when word = '' then null
    else encode(extensions.digest(p_household_id::text || ':' || word, 'sha256'), 'hex')
  end
  where id = p_household_id;
end;
$$;

create function public.household_has_safe_word(p_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_household_member(p_household_id)
    and exists (select 1 from public.households where id = p_household_id and safe_word_hash is not null);
$$;

revoke execute on function public.claim_screening_line() from public, anon;
revoke execute on function public.set_safe_word(uuid, text) from public, anon;
revoke execute on function public.household_has_safe_word(uuid) from public, anon;

alter publication supabase_realtime add table public.screened_calls;
