-- Accounts and sync for Lineup (applied by `npm run setup:cloud`, safe to re-run).
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

drop policy if exists "audio delete own" on storage.objects;
create policy "audio delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Deletes the signed-in account; its synced items go with it (on delete cascade).
-- Music files are removed by the app first, through the Storage API.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Shared choreographies (real-time collaboration). An account is required.
-- A room holds the choreography as a flat map { key: { v, t } } (last timestamp wins).
-- Links carry a room id + a code: the edit code gives "edit", the view code gives "view".
-- ============================================================================

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  edit_code text not null unique,
  view_code text not null unique,
  entries jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security; -- no policies: only reachable through the functions below

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'edit', 'view')),
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_members enable row level security;

create or replace function public.safe_uuid(p text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- role of the signed-in user in a room (null = no access); bypasses RLS to avoid policy recursion
create or replace function public.room_role(p_room uuid)
returns text language sql stable security definer set search_path = '' as $$
  select role from public.room_members where room_id = p_room and user_id = (select auth.uid())
$$;
revoke all on function public.room_role(uuid) from public, anon;
grant execute on function public.safe_uuid(text) to authenticated;
grant execute on function public.room_role(uuid) to authenticated;

drop policy if exists "members see members" on public.room_members;
create policy "members see members" on public.room_members
  for select to authenticated
  using (public.room_role(room_id) is not null);

drop policy if exists "leave or remove members" on public.room_members;
create policy "leave or remove members" on public.room_members
  for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid()) or public.room_role(room_id) = 'owner'));

create or replace function public.create_room(p_entries jsonb, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.rooms (owner, edit_code, view_code, entries)
  values (auth.uid(), replace(gen_random_uuid()::text, '-', ''), replace(gen_random_uuid()::text, '-', ''), coalesce(p_entries, '{}'::jsonb))
  returning * into r;
  insert into public.room_members (room_id, user_id, role, name) values (r.id, auth.uid(), 'owner', left(coalesce(p_name, ''), 40));
  return jsonb_build_object('room', r.id, 'edit_code', r.edit_code, 'view_code', r.view_code);
end
$$;

create or replace function public.join_room(p_room uuid, p_code text, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  v_role text;
  cur text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into r from public.rooms where id = p_room;
  if not found then
    raise exception 'invalid link';
  end if;
  v_role := case when p_code = r.edit_code then 'edit' when p_code = r.view_code then 'view' end;
  select role into cur from public.room_members where room_id = p_room and user_id = auth.uid();
  if v_role is null and cur is null then
    raise exception 'invalid link';
  end if;
  -- never downgrade: owner stays owner, an editor opening the read-only link stays editor
  if cur = 'owner' or (cur = 'edit' and v_role is distinct from 'edit') or v_role is null then
    v_role := cur;
  end if;
  insert into public.room_members (room_id, user_id, role, name)
  values (p_room, auth.uid(), v_role, left(coalesce(p_name, ''), 40))
  on conflict (room_id, user_id) do update
    set role = excluded.role,
        name = case when excluded.name <> '' then excluded.name else public.room_members.name end;
  return v_role;
end
$$;

create or replace function public.room_open(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rooms;
  v_role text;
begin
  select role into v_role from public.room_members where room_id = p_room and user_id = auth.uid();
  if v_role is null then
    raise exception 'no access';
  end if;
  select * into r from public.rooms where id = p_room;
  return jsonb_build_object(
    'role', v_role,
    'entries', r.entries,
    'edit_code', case when v_role in ('owner', 'edit') then r.edit_code end,
    'view_code', case when v_role in ('owner', 'edit') then r.view_code end
  );
end
$$;

create or replace function public.room_push(p_room uuid, p_ops jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cur jsonb;
  op jsonb;
  k text;
  t text;
  n integer := 0;
begin
  if public.room_role(p_room) not in ('owner', 'edit') or public.room_role(p_room) is null then
    raise exception 'read only';
  end if;
  select entries into cur from public.rooms where id = p_room for update;
  for op in select * from jsonb_array_elements(p_ops) loop
    k := op ->> 'k';
    t := op ->> 't';
    if k is null or t is null or length(k) > 120 or length(t) > 40 then
      continue;
    end if;
    if cur ? k and (cur -> k ->> 't') >= t then
      continue;
    end if;
    cur := jsonb_set(cur, array[k], jsonb_build_object('v', coalesce(op -> 'v', 'null'::jsonb), 't', t), true);
    n := n + 1;
  end loop;
  if n > 0 then
    update public.rooms set entries = cur, updated_at = now() where id = p_room;
  end if;
  return n;
end
$$;

create or replace function public.rotate_room_codes(p_room uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
begin
  if public.room_role(p_room) is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  update public.rooms
    set edit_code = replace(gen_random_uuid()::text, '-', ''), view_code = replace(gen_random_uuid()::text, '-', '')
    where id = p_room
    returning * into r;
  return jsonb_build_object('edit_code', r.edit_code, 'view_code', r.view_code);
end
$$;

revoke all on function public.create_room(jsonb, text) from public, anon;
revoke all on function public.join_room(uuid, text, text) from public, anon;
revoke all on function public.room_open(uuid) from public, anon;
revoke all on function public.room_push(uuid, jsonb) from public, anon;
revoke all on function public.rotate_room_codes(uuid) from public, anon;
grant execute on function public.create_room(jsonb, text) to authenticated;
grant execute on function public.join_room(uuid, text, text) to authenticated;
grant execute on function public.room_open(uuid) to authenticated;
grant execute on function public.room_push(uuid, jsonb) to authenticated;
grant execute on function public.rotate_room_codes(uuid) to authenticated;

-- live channel "room:<id>": members receive; editors send changes; everyone shares presence
drop policy if exists "room members receive" on realtime.messages;
create policy "room members receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'room:%'
    and public.room_role(public.safe_uuid(split_part((select realtime.topic()), ':', 2))) is not null
  );

drop policy if exists "room members send" on realtime.messages;
create policy "room members send" on realtime.messages
  for insert to authenticated
  with check (
    (select realtime.topic()) like 'room:%'
    and (
      (realtime.messages.extension = 'presence' and public.room_role(public.safe_uuid(split_part((select realtime.topic()), ':', 2))) is not null)
      or (realtime.messages.extension = 'broadcast' and public.room_role(public.safe_uuid(split_part((select realtime.topic()), ':', 2))) in ('owner', 'edit'))
    )
  );

-- shared music: "room-audio/<room id>/<hash>"
insert into storage.buckets (id, name, public, file_size_limit)
values ('room-audio', 'room-audio', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "room audio read" on storage.objects;
create policy "room audio read" on storage.objects
  for select to authenticated
  using (bucket_id = 'room-audio' and public.room_role(public.safe_uuid((storage.foldername(name))[1])) is not null);

drop policy if exists "room audio write" on storage.objects;
create policy "room audio write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'room-audio' and public.room_role(public.safe_uuid((storage.foldername(name))[1])) in ('owner', 'edit'));

drop policy if exists "room audio update" on storage.objects;
create policy "room audio update" on storage.objects
  for update to authenticated
  using (bucket_id = 'room-audio' and public.room_role(public.safe_uuid((storage.foldername(name))[1])) in ('owner', 'edit'));

notify pgrst, 'reload schema';
