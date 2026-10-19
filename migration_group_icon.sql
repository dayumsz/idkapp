-- Group icons.
-- Run once in the Supabase SQL editor (safe to run again).

alter table conversations add column if not exists icon_url text;

-- only the owner of a group can change (or clear) its icon, passing null or '' removes it
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

-- so every member sees the new icon right away
do $$ begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then null;
end $$;
