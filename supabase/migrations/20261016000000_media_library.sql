-- Her media library on the Marketing page: her own photos, and finished posts to reuse.
-- Files live in the private Storage bucket "media". This table holds what the app and
-- Athena need to find them. It is not synced to Obsidian: files stay out of the vault.
--
-- The project is on Supabase's free plan: 1 GB of storage and 50 MB per file. The app
-- shrinks photos to 2048 pixels on their longest side before upload to fit that.

create table public.media (
  id uuid primary key default gen_random_uuid(),
  shelf text not null check (shelf in ('photo','finished')),
  title text not null,
  tags text[] not null default '{}',
  notes text,
  seed int,                     -- the idea bank seed a finished post came from
  path text not null unique,    -- object in the media bucket
  thumb_path text,              -- small preview; null when the browser could not make one
  mime text not null,
  bytes bigint not null,        -- size of the file plus its preview, for the space meter
  width int,
  height int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz        -- unused (the app deletes for real to free space); db.py and useRows filter on it
);
alter table public.media enable row level security;
create policy "owner all" on public.media for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
-- No touch_updated_at trigger: that function reads synced_at, which this table does not have.
-- The app sets updated_at when it saves a change.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

create policy "media owner read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_owner());
create policy "media owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_owner());
create policy "media owner update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_owner()) with check (bucket_id = 'media' and public.is_owner());
create policy "media owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_owner());
