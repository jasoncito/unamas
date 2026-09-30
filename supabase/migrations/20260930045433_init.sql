-- unamas: cloud schema (docs/MULTIUSER.md §3). Same tables as the phone's SQLite, plus:
--   user_id            set by Postgres from the session (default auth.uid()); the client never sends it
--   server_updated_at  set by a trigger on every write, with the server clock: the cursor sync pulls from
-- No `dirty` column: that only exists on the phone.

-- ─── Tables ─────────────────────────────────────────────────────────────────────────────────────

create table public.exercise (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  canonical_name    text not null,
  aliases           jsonb not null default '[]'::jsonb,
  muscle_groups     jsonb not null,
  kind              text not null check (kind in ('compound_heavy', 'compound', 'isolation', 'calf')),
  rep_floor         integer not null,
  rep_top           integer not null,
  step_kg           double precision not null,
  load_basis        text not null check (load_basis in ('per_side', 'per_dumbbell', 'total', 'stack')),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default now(),
  -- Target of the composite foreign keys below: an entry can only point at its owner's rows.
  unique (id, user_id)
);

create table public.session (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  muscle_groups     jsonb not null,
  started_at        timestamptz,
  ended_at          timestamptz,
  avg_bpm           integer,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.entry (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id        uuid not null,
  exercise_id       uuid,
  load_kg           double precision,
  reps              jsonb,
  raw_text          text not null,
  rir_note          text,
  status            text not null default 'ok' check (status in ('ok', 'pending', 'ambiguous')),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.session (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercise (id, user_id) on delete cascade
);

-- Pull: "my rows changed after the cursor". Also covers the RLS filter on user_id.
create index exercise_user_server_updated on public.exercise (user_id, server_updated_at);
create index session_user_server_updated on public.session (user_id, server_updated_at);
create index entry_user_server_updated on public.entry (user_id, server_updated_at);

-- ─── server_updated_at ──────────────────────────────────────────────────────────────────────────

create function public.set_server_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

create trigger exercise_server_updated_at before insert or update on public.exercise
  for each row execute function public.set_server_updated_at();
create trigger session_server_updated_at before insert or update on public.session
  for each row execute function public.set_server_updated_at();
create trigger entry_server_updated_at before insert or update on public.entry
  for each row execute function public.set_server_updated_at();

-- ─── Access ─────────────────────────────────────────────────────────────────────────────────────
-- Anonymous app users sign in with signInAnonymously(), so they are `authenticated` too.
-- The bare `anon` role (publishable key, no session) gets nothing. Rows are soft-deleted with an
-- update, so clients get no DELETE; account deletion uses the service role and cascades.

revoke all on table public.exercise, public.session, public.entry from anon, authenticated;
grant select, insert, update on table public.exercise, public.session, public.entry to authenticated;

alter table public.exercise enable row level security;
alter table public.session enable row level security;
alter table public.entry enable row level security;

create policy "own rows" on public.exercise for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own rows" on public.session for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own rows" on public.entry for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
