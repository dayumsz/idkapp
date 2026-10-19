-- Allow GIFs (and videos) to be sent from the media picker.
-- Run once in the Supabase SQL editor (safe to run again).

-- column used by video messages (no-op if it already exists)
alter table public.messages add column if not exists video_url text;

-- public chat media: photos, GIFs and videos up to 50 MB
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'],
       file_size_limit = 52428800
 where id = 'chat-images';

-- view-once media: photos and GIFs
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif'],
       file_size_limit = 52428800
 where id = 'chat-once';
