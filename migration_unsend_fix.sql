-- Fix "Delete for everyone". Run once in the Supabase SQL editor (safe to run again).

alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists gif_url text;
alter table public.messages add column if not exists video_url text;

-- the sender may update (unsend) their own messages
drop policy if exists "senders can unsend own messages" on public.messages;
create policy "senders can unsend own messages" on public.messages
for update to authenticated
using (sender_id = auth.uid() and public.is_member(conversation_id))
with check (sender_id = auth.uid() and public.is_member(conversation_id));

-- make sure realtime keeps broadcasting message updates to the other people in the chat
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
