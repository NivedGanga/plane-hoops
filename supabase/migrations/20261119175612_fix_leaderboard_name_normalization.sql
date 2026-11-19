begin;

alter table public.leaderboard
  drop constraint leaderboard_name_key_check;

alter table public.leaderboard
  add constraint leaderboard_name_key_check
  check (name_key = lower(btrim(regexp_replace(team_name, '\s+', ' ', 'g'))));

commit;
