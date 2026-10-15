-- Ties Media files to the post they belong to, so a piece in the Pipeline shows its images.
-- Athena fills these when she makes a post (athena/POSTS.md); the app sets content_id when
-- Stephanie asks for a caption for something already in Media.
--   content_id: the content row the file goes with. Many files can share one post.
--   source_url: where the file was made, such as the visual's page in Blotato.
alter table public.media
  add column content_id uuid references public.content(id) on delete set null,
  add column source_url text;
create index media_content_id_idx on public.media (content_id) where content_id is not null;
