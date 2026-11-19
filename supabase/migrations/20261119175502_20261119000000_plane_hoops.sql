begin;

create or replace function public.valid_members(p_members text[])
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select cardinality(p_members) between 1 and 4
     and array_position(p_members, null) is null
     and not exists (
       select 1
       from unnest(p_members) as member_name
       where char_length(member_name) not between 1 and 16
     );
$$;

create table public.rooms (
  code text primary key
    check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  host_uid uuid not null,
  name text not null check (char_length(name) between 1 and 24),
  size smallint not null check (size in (2, 4)),
  status text not null check (status in ('lobby', 'playing', 'closed')),
  run_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.signals (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  from_uid uuid not null,
  to_uid uuid not null,
  kind text not null check (kind in ('offer', 'answer', 'ice')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index signals_to_uid_created_at_idx on public.signals (to_uid, created_at);

create table public.leaderboard (
  id text primary key,
  owner_uid uuid not null,
  team_name text not null check (char_length(team_name) between 1 and 24),
  name_key text not null,
  members text[] not null,
  points integer not null check (points >= 0),
  hoops_cleared integer not null check (hoops_cleared >= 0),
  distance_m double precision not null check (distance_m >= 0),
  updated_at timestamptz not null default now(),
  constraint leaderboard_id_owner_name_key_check
    check (id = owner_uid::text || '__' || name_key),
  constraint leaderboard_name_key_check
    check (name_key = lower(btrim(regexp_replace(team_name, '\s+', ' ', 'g')))),
  constraint leaderboard_members_check check (public.valid_members(members))
);
create index leaderboard_rank_idx
  on public.leaderboard (points desc, distance_m desc, updated_at asc);

alter table public.rooms enable row level security;
alter table public.signals enable row level security;
alter table public.leaderboard enable row level security;

revoke all on public.rooms, public.signals, public.leaderboard from public, anon, authenticated;
grant select, insert, update, delete on public.rooms, public.signals, public.leaderboard to authenticated;
revoke all on sequence public.signals_id_seq from public, anon, authenticated;
grant usage, select on sequence public.signals_id_seq to authenticated;

create policy rooms_host_select on public.rooms for select to authenticated using (host_uid = (select auth.uid()));
create policy rooms_host_insert on public.rooms for insert to authenticated
  with check (host_uid = (select auth.uid()) and char_length(name) between 1 and 24 and size in (2, 4) and status = 'lobby');
create policy rooms_host_update on public.rooms for update to authenticated
  using (host_uid = (select auth.uid())) with check (host_uid = (select auth.uid()));
create policy rooms_host_delete on public.rooms for delete to authenticated using (host_uid = (select auth.uid()));

create policy signals_sender_insert on public.signals for insert to authenticated
  with check (from_uid = (select auth.uid()));
create policy signals_recipient_select on public.signals for select to authenticated
  using (to_uid = (select auth.uid()));
create policy signals_recipient_delete on public.signals for delete to authenticated
  using (to_uid = (select auth.uid()));

create policy leaderboard_authenticated_select on public.leaderboard for select to authenticated using (true);
create policy leaderboard_owner_insert on public.leaderboard for insert to authenticated
  with check (owner_uid = (select auth.uid()));
create policy leaderboard_owner_update on public.leaderboard for update to authenticated
  using (owner_uid = (select auth.uid())) with check (owner_uid = (select auth.uid()));
create policy leaderboard_owner_delete on public.leaderboard for delete to authenticated
  using (owner_uid = (select auth.uid()));

create or replace function public.get_room(p_code text)
returns setof public.rooms
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.* from public.rooms as r
  where r.code = p_code and r.status <> 'closed'
  limit 1;
$$;
revoke all on function public.get_room(text) from public, anon, authenticated;
grant execute on function public.get_room(text) to authenticated;

-- Supabase Realtime publication exists on hosted projects; add idempotently.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signals'
  ) then
    alter publication supabase_realtime add table public.signals;
  end if;
end
$$;

-- pg_cron is optional. Missing extension, permissions, or scheduler support must not block migration.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$
      select cron.schedule(
        'plane-hoops-expire-signals-nightly',
        '0 3 * * *',
        $job$delete from public.signals where created_at < now() - interval '1 hour'$job$
      )
      where not exists (select 1 from cron.job where jobname = 'plane-hoops-expire-signals-nightly')
    $cron$;
  end if;
exception when others then
  raise notice 'Skipping optional pg_cron signal cleanup schedule: %', sqlerrm;
end
$$;

commit;
