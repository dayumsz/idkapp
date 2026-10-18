-- Spoiler images and view once photos.
-- Run once in the Supabase SQL editor.

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
