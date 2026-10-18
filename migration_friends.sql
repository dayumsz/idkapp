alter table profiles alter column display_name set default 'User';
alter table conversations add column if not exists owner_id uuid references profiles on delete set null;
drop function if exists create_conversation(text[], text);

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

insert into friendships (requester_id, addressee_id, status)
select a.user_id, b.user_id, 'accepted'
from members a
join members b on a.conversation_id = b.conversation_id and a.user_id < b.user_id
join conversations c on c.id = a.conversation_id and not c.is_group
on conflict do nothing;

update conversations c
set owner_id = (select m.user_id from members m where m.conversation_id = c.id limit 1)
where c.is_group and c.owner_id is null;
