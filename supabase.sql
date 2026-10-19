create table profiles (
  id uuid primary key references auth.users on delete cascade,
  public_id text unique not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  display_name text not null default 'User',
  avatar_url text,
  banner_url text,
  bio text,
  created_at timestamptz not null default now()
);
create table conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  owner_id uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);
create table members (
  conversation_id uuid references conversations on delete cascade,
  user_id uuid references profiles on delete cascade,
  primary key (conversation_id, user_id)
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations on delete cascade,
  sender_id uuid not null references profiles,
  kind text not null default 'text',
  body text,
  image_url text,
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function is_member(cid uuid) returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where conversation_id = cid and user_id = auth.uid())
$$;

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table members enable row level security;
alter table messages enable row level security;

create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles update own" on profiles for update to authenticated using (id = auth.uid());
create policy "conversations read" on conversations for select to authenticated using (is_member(id));
create policy "members read" on members for select to authenticated using (is_member(conversation_id));
create policy "messages read" on messages for select to authenticated using (is_member(conversation_id));
create policy "messages insert" on messages for insert to authenticated with check (is_member(conversation_id) and sender_id = auth.uid());

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit) values
  ('avatars', 'avatars', true, array['image/png', 'image/jpeg'], 3145728),
  ('chat-images', 'chat-images', true, array['image/png', 'image/jpeg'], 10485760),
  ('banners', 'banners', true, array['image/png', 'image/jpeg', 'image/gif'], 8388608);
create policy "upload images" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'chat-images', 'banners') and (storage.foldername(name))[1] = auth.uid()::text);

alter publication supabase_realtime add table messages, members;

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles on delete cascade,
  addressee_id uuid not null references profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
alter table friendships enable row level security;
create policy "friendships read" on friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create function are_friends(a uuid, b uuid) returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  )
$$;

create function send_friend_request(target_public_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid; f friendships;
begin
  select id into target from profiles where public_id = upper(trim(target_public_id));
  if target is null then raise exception 'ID not found'; end if;
  if target = me then raise exception 'You cannot add yourself'; end if;
  select * into f from friendships
  where (requester_id = me and addressee_id = target) or (requester_id = target and addressee_id = me);
  if found then
    if f.status = 'accepted' then raise exception 'Already friends'; end if;
    if f.requester_id = me then raise exception 'Request already sent'; end if;
    update friendships set status = 'accepted' where id = f.id;
    return;
  end if;
  insert into friendships (requester_id, addressee_id) values (me, target);
end $$;

create function accept_friend(other uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update friendships set status = 'accepted'
  where requester_id = other and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Request not found'; end if;
end $$;

create function remove_friend(other uuid) returns void language sql security definer set search_path = public as $$
  delete from friendships
  where (requester_id = auth.uid() and addressee_id = other) or (requester_id = other and addressee_id = auth.uid())
$$;

create function open_dm(friend uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if not are_friends(me, friend) then raise exception 'You can only message friends'; end if;
  select c.id into cid from conversations c
  where not c.is_group
    and exists (select 1 from members where conversation_id = c.id and user_id = me)
    and exists (select 1 from members where conversation_id = c.id and user_id = friend)
  limit 1;
  if cid is null then
    insert into conversations (is_group) values (false) returning id into cid;
    insert into members (conversation_id, user_id) values (cid, me), (cid, friend);
  end if;
  return cid;
end $$;

create function create_group(group_name text, member_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; m uuid;
begin
  if group_name is null or btrim(group_name) = '' then raise exception 'Group name required'; end if;
  foreach m in array coalesce(member_ids, '{}') loop
    if not are_friends(me, m) then raise exception 'You can only add friends to a group'; end if;
  end loop;
  insert into conversations (name, is_group, owner_id) values (btrim(group_name), true, me) returning id into cid;
  insert into members (conversation_id, user_id)
  select distinct cid, x from unnest(array_append(coalesce(member_ids, '{}'), me)) as x;
  return cid;
end $$;

create function add_group_member(cid uuid, new_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from conversations where id = cid and is_group and owner_id = me) then
    raise exception 'Only the group owner can add members';
  end if;
  if not are_friends(me, new_member) then raise exception 'You can only add your friends'; end if;
  insert into members (conversation_id, user_id) values (cid, new_member) on conflict do nothing;
end $$;

create function leave_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nxt uuid;
begin
  delete from members
  where conversation_id = cid and user_id = me
    and exists (select 1 from conversations where id = cid and is_group);
  select user_id into nxt from members where conversation_id = cid limit 1;
  if nxt is null then
    delete from conversations where id = cid and is_group;
  else
    update conversations set owner_id = nxt where id = cid and owner_id = me;
  end if;
end $$;

alter publication supabase_realtime add table friendships;

-- spoiler and view once (see migration_media.sql)
alter table messages add column if not exists spoiler boolean not null default false;
alter table messages add column if not exists view_once boolean not null default false;

-- View once photos live in a private bucket, the path is only readable through open_view_once()
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('chat-once', 'chat-once', false, array['image/png', 'image/jpeg'], 10485760)
on conflict (id) do nothing;

create policy "upload once media" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-once' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists once_media (
  message_id uuid primary key references messages on delete cascade,
  path text not null
);
alter table once_media enable row level security; -- no policies, only the functions below touch it

create table if not exists message_views (
  message_id uuid not null references messages on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table message_views enable row level security;
create policy "views read" on message_views for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from messages m where m.id = message_id and m.sender_id = auth.uid())
  );

create or replace function can_read_once(p text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from once_media o
    join message_views v on v.message_id = o.message_id
    where o.path = p and v.user_id = auth.uid() and v.viewed_at > now() - interval '2 minutes'
  )
$$;

-- a photo can only be read for a short window right after the recipient opened it
create policy "read once media" on storage.objects for select to authenticated
  using (bucket_id = 'chat-once' and can_read_once(name));

create or replace function send_view_once(cid uuid, path text, caption text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mid uuid;
begin
  if not is_member(cid) then raise exception 'Not a member of this conversation'; end if;
  if split_part(path, '/', 1) <> me::text then raise exception 'Invalid path'; end if;
  insert into messages (conversation_id, sender_id, body, view_once)
  values (cid, me, nullif(btrim(caption), ''), true) returning id into mid;
  insert into once_media (message_id, path) values (mid, path);
  return mid;
end $$;

create or replace function open_view_once(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m messages; p text;
begin
  select * into m from messages where id = mid and view_once;
  if not found or not is_member(m.conversation_id) then raise exception 'Not found'; end if;
  if m.sender_id = me then raise exception 'You cannot open your own photo'; end if;
  insert into message_views (message_id, user_id) values (mid, me) on conflict do nothing;
  if not found then
    -- short grace period so a failed download can be retried
    if not exists (
      select 1 from message_views
      where message_id = mid and user_id = me and viewed_at > now() - interval '30 seconds'
    ) then
      raise exception 'Already opened';
    end if;
  end if;
  select path into p from once_media where message_id = mid;
  return p;
end $$;

alter publication supabase_realtime add table message_views;

-- group icons (see migration_group_icon.sql)
alter table conversations add column if not exists icon_url text;

create or replace function set_group_icon(cid uuid, url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from conversations where id = cid and is_group and owner_id = auth.uid()) then
    raise exception 'Only the group owner can change the icon';
  end if;
  if nullif(btrim(url), '') is not null and url !~ '^https?://' then
    raise exception 'Invalid icon url';
  end if;
  update conversations set icon_url = nullif(btrim(url), '') where id = cid;
end $$;

do $$ begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then null;
end $$;
