-- The call gate: a caller dialing Squeek's number says a secret word, and only the right word puts
-- them through to the person's phone. Each wrong guess is recorded here (the line and the time,
-- never the word) so verify-safe-word can stop someone trying word after word.
-- Service role only: no policies, so clients can't read or write it.
create table public.safe_word_attempts (
  id uuid primary key default gen_random_uuid(),
  line text not null,
  created_at timestamptz not null default now()
);
create index safe_word_attempts_line_idx on public.safe_word_attempts (line, created_at desc);
alter table public.safe_word_attempts enable row level security;
revoke all on public.safe_word_attempts from anon, authenticated;
