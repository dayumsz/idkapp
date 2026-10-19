-- Chat enhancements: receipts, unsend, replies, message/GIF favorites and GIF embeds.
-- Run this once in the Supabase SQL editor for the project.

alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists gif_url text;

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('delivered','seen')),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_receipts enable row level security;
drop policy if exists "receipts visible to conversation members" on public.message_receipts;
create policy "receipts visible to conversation members" on public.message_receipts
for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
);
drop policy if exists "users create own receipts" on public.message_receipts;
create policy "users create own receipts" on public.message_receipts
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id))
);
drop policy if exists "users update own receipts" on public.message_receipts;
create policy "users update own receipts" on public.message_receipts
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.message_favorites (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_favorites enable row level security;
drop policy if exists "users manage own message favorites" on public.message_favorites;
create policy "users manage own message favorites" on public.message_favorites
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.gif_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  gif_url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, gif_url)
);
alter table public.gif_favorites enable row level security;
drop policy if exists "users manage own GIF favorites" on public.gif_favorites;
create policy "users manage own GIF favorites" on public.gif_favorites
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Enable realtime events for live read/delivery indicators.
do $$
begin
  alter publication supabase_realtime add table public.message_receipts;
exception when duplicate_object then null;
end $$;


-- Automatically mark a new message as delivered to the other conversation members.
create or replace function public.create_message_delivery_receipts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.message_receipts (message_id, user_id, status)
  select new.id, cm.user_id, 'delivered'
  from public.members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists message_delivery_receipts on public.messages;
create trigger message_delivery_receipts
after insert on public.messages
for each row execute function public.create_message_delivery_receipts();

-- Allow the sender to replace their own message content with the unsent marker.
drop policy if exists "senders can unsend own messages" on public.messages;
create policy "senders can unsend own messages" on public.messages
for update to authenticated
using (sender_id = auth.uid() and public.is_member(conversation_id))
with check (sender_id = auth.uid() and public.is_member(conversation_id));
