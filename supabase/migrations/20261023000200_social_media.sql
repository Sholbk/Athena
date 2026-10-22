-- Social Media page (/social): a weekly scorecard of how her own posts did on every platform,
-- each post compared to her own usual on that platform and format, plus her audience size.
--
-- No new job. The Post numbers job (athena/stats.py pull) fills everything: Instagram and
-- Facebook posts from Blotato, LinkedIn posts through Apify, and now YouTube videos from
-- YouTube's free channel feed and follower counts for the accounts below. The job stays as
-- she set it; the page has a Refresh numbers button. Nothing here posts anywhere.

-- YouTube videos come from the channel feed, so posts gets a third source.
alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check
  check (source in ('blotato', 'linkedin', 'youtube', 'manual'));

-- Video, image, carousel or text, so a reel is compared with her other reels, not her photos.
alter table public.posts add column format text check (format in ('video', 'image', 'carousel', 'text'));

-- The accounts whose follower count the job checks. She can add rows (for example the
-- ColibriOS LinkedIn page by its web address) and the next run picks them up.
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'facebook', 'linkedin', 'youtube', 'twitter', 'other')),
  url text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.social_accounts enable row level security;
create policy "owner all" on public.social_accounts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

insert into public.social_accounts (platform, url, label) values
  ('instagram', 'https://www.instagram.com/colibrios.app/', 'Instagram'),
  ('linkedin', 'https://www.linkedin.com/in/stephaniebholbrook/', 'LinkedIn'),
  ('youtube', 'https://www.youtube.com/channel/UCKM3BLEjwjcQ4mQD6dZw6UA', 'YouTube')
on conflict (url) do nothing;

-- One follower count per account per Mountain day. Blank means not collected, never zero.
create table public.follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  taken_on date not null,
  followers int,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (account_id, taken_on)
);
alter table public.follower_snapshots enable row level security;
create policy "owner all" on public.follower_snapshots for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index follower_snapshots_account on public.follower_snapshots (account_id, taken_on desc);
