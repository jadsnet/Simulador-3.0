-- Simulador Academy V6.2.0 — Storage privado de imagens
-- Execute uma vez no Supabase: SQL Editor > New query > Run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  false,
  10485760,
  array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "question_images_select_own" on storage.objects;
drop policy if exists "question_images_insert_own" on storage.objects;
drop policy if exists "question_images_update_own" on storage.objects;
drop policy if exists "question_images_delete_own" on storage.objects;

create policy "question_images_select_own"
on storage.objects for select to authenticated
using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "question_images_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "question_images_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "question_images_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);
