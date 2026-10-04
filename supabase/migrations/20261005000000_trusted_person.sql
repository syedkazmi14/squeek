-- Trusted person. Two things a helper and the person they look out for do for each other:
--   * helper_alerts: remembers that a risky payment already phoned the helpers, so it happens once.
--   * check_ins: a helper asks "are you OK?"; the person answers from Home, and the helper sees it live.
-- Neither stores anything about the scam itself, only that the helper was told or the person answered.

-- Service role only (no policies): notify-helpers writes it to claim an incident before phoning.
create table public.helper_alerts (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.helper_alerts enable row level security;
revoke all on public.helper_alerts from anon, authenticated;

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  protected_user_id uuid not null references auth.users (id) on delete cascade,
  helper_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'asked' check (status in ('asked', 'ok', 'call_me')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index check_ins_protected_idx on public.check_ins (protected_user_id, created_at desc);
create index check_ins_helper_idx on public.check_ins (helper_id, created_at desc);

alter table public.check_ins enable row level security;
create policy check_ins_select on public.check_ins for select to authenticated
  using (protected_user_id = (select auth.uid()) or helper_id = (select auth.uid()));
-- Writes go through the two functions below, which check who is allowed to do what.
revoke insert, update, delete on public.check_ins from anon, authenticated;

-- A helper asks one of the people they look out for. Returns the open check-in, and whether this
-- call made a new one (so check-in only phones the person once, not on every tap).
create function public.ask_check_in(p_person uuid)
returns table (id uuid, is_new boolean)
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  existing uuid;
  created uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select me.household_id into hid
  from public.household_members me
  join public.household_members them on them.household_id = me.household_id
  where me.user_id = auth.uid() and me.role = 'helper' and them.user_id = p_person and them.role = 'protected'
  limit 1;
  if hid is null then raise exception 'not their helper'; end if;

  -- Still waiting for an answer from the last day, or asked within the last few minutes: reuse it.
  select c.id into existing from public.check_ins c
  where c.helper_id = auth.uid() and c.protected_user_id = p_person
    and ((c.status = 'asked' and c.created_at > now() - interval '1 day') or c.created_at > now() - interval '5 minutes')
  order by c.created_at desc limit 1;
  if existing is not null then
    return query select existing, false;
    return;
  end if;

  insert into public.check_ins (household_id, protected_user_id, helper_id)
  values (hid, p_person, auth.uid())
  returning check_ins.id into created;
  return query select created, true;
end;
$$;

-- The person answers a check-in. Only they can, once, and only within a day of being asked.
create function public.answer_check_in(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ok', 'call_me') then raise exception 'bad answer'; end if;
  update public.check_ins
  set status = p_status, answered_at = now()
  where id = p_id and protected_user_id = auth.uid() and status = 'asked'
    and created_at > now() - interval '1 day';
  if not found then raise exception 'no open check-in'; end if;
end;
$$;

revoke execute on function public.ask_check_in(uuid) from public, anon;
revoke execute on function public.answer_check_in(uuid, text) from public, anon;

alter publication supabase_realtime add table public.check_ins;
