-- Accounts and sync for Formation Studio (applied by `npm run setup:cloud`, safe to re-run).
-- Every choreography, team and folder is one row; each user only ever sees their own rows.

create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('choreo', 'team', 'folder')),
  id text not null,
  data jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists items_user_server_ts on public.items (user_id, server_ts);

alter table public.items enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Upsert a batch; an older copy never overwrites a newer one (last edit wins).
create or replace function public.push_items(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  with input as (
    select
      r ->> 'kind' as kind,
      r ->> 'id' as id,
      r -> 'data' as data,
      (r ->> 'updated_at')::bigint as updated_at,
      coalesce((r ->> 'deleted')::boolean, false) as deleted
    from jsonb_array_elements(rows) as r
  ), written as (
    insert into public.items as t (user_id, kind, id, data, updated_at, deleted, server_ts)
    select auth.uid(), kind, id, data, updated_at, deleted, clock_timestamp() from input
    on conflict (user_id, kind, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          server_ts = clock_timestamp()
      where t.updated_at < excluded.updated_at
    returning 1
  )
  select count(*) into n from written;
  return n;
end
$$;
revoke all on function public.push_items(jsonb) from public, anon;
grant execute on function public.push_items(jsonb) to authenticated;

-- Tiny query used by the daily keep-alive (free projects pause after 7 idle days).
create or replace function public.keepalive()
returns integer
language sql
stable
set search_path = ''
as $$ select 1 $$;
grant execute on function public.keepalive() to anon, authenticated;

-- Music files: private bucket, one folder per user.
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "audio read own" on storage.objects;
create policy "audio read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio insert own" on storage.objects;
create policy "audio insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio update own" on storage.objects;
create policy "audio update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
