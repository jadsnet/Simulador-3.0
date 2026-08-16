-- Simulador Academy V7.9.3 — nome e foto de perfil
-- Execute no SQL Editor e depois execute SUPABASE_FRIEND_VISITS_V7_8.sql novamente.

alter table public.user_profiles add column if not exists avatar_url text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',true,5242880,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "profile_avatars_public_read" on storage.objects;
drop policy if exists "profile_avatars_insert_own" on storage.objects;
drop policy if exists "profile_avatars_update_own" on storage.objects;
drop policy if exists "profile_avatars_delete_own" on storage.objects;

create policy "profile_avatars_public_read" on storage.objects for select
using(bucket_id='profile-avatars');
create policy "profile_avatars_insert_own" on storage.objects for insert to authenticated
with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "profile_avatars_update_own" on storage.objects for update to authenticated
using(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "profile_avatars_delete_own" on storage.objects for delete to authenticated
using(bucket_id='profile-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
