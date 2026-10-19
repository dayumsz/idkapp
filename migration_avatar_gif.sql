-- Animated GIF profile pictures.
-- Run once in the Supabase SQL editor (safe to run again).

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif'],
       file_size_limit = 5242880
 where id = 'avatars';
