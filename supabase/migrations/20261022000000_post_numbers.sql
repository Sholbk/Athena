-- Post numbers: how her social posts did, on the Marketing page as "Results".
--
-- Blotato already counts views, reach, likes, comments, saves and shares for the Instagram and
-- Facebook posts she publishes through it, about once a week. LinkedIn has no numbers in
-- Blotato, so the job reads her own public LinkedIn posts through Apify (reactions, comments,
-- shares; LinkedIn shows impressions only to her). The weekly job "Post numbers"
-- (athena/stats.py, guide athena/STATS.md) copies both into these two tables. Nothing here
-- posts, schedules or touches any social network.
--
-- Neither table syncs to Obsidian (sync.py works from a fixed list).

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'facebook', 'linkedin', 'youtube', 'twitter', 'other')),
  source text not null check (source in ('blotato', 'linkedin', 'manual')),   -- where the numbers come from
  external_id text not null,           -- Blotato's published post id, or "a" + the activity digits of a LinkedIn post
  post_url text,
  posted_at timestamptz not null,
  caption text,
  content_id uuid references public.content(id) on delete set null,   -- the piece it came from, when known
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (source, external_id)
);
alter table public.posts enable row level security;
create policy "owner all" on public.posts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index posts_posted_at on public.posts (posted_at desc);
create index posts_content on public.posts (content_id);

-- One row per snapshot Blotato (or the LinkedIn scan) took. Blank means not collected, never zero.
create table public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  fetched_at timestamptz not null,
  views int,
  reach int,
  likes int,
  comments int,
  saves int,
  shares int,
  follows int,
  clicks int,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,              -- never set by the job; here so the app reads it like every other table
  unique (post_id, fetched_at)
);
alter table public.post_metrics enable row level security;
create policy "owner all" on public.post_metrics for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index post_metrics_post on public.post_metrics (post_id, fetched_at desc);

-- "I posted it" now remembers when, and the link she pastes ties the piece to its numbers.
alter table public.content add column posted_at timestamptz;
alter table public.content add column post_url text;

-- Her own LinkedIn profile link, so the scan knows whose posts to read. Not a secret.
alter table public.connections drop constraint connections_key_check;
alter table public.connections add constraint connections_key_check
  check (key in ('wonderreel', 'calendar_feed', 'google', 'google_state', 'linkedin_profile'));

-- The job. Off until Stephanie turns it on in Settings. The Results tab has a Refresh button.
insert into public.athena_jobs (key, title, kind, days, run_at, enabled, prompt) values (
  'post_numbers', 'Post numbers', 'report', '{1}', '07:00', false,
$prompt$You are Athena. This run brings in the numbers for Stephanie's social posts so her Results tab (Marketing page) is current. Follow "Post numbers" below for the tools and the note you hand back.

Run the pull once with a spend cap of $0.20 for the LinkedIn scan. Then write the note: what came in, which post did best this week by reach (Instagram) and by reactions (LinkedIn), and anything that did not work. Use only numbers the tools printed. Never make up a number, and never say a post did well when its numbers are small: say the numbers.$prompt$
) on conflict (key) do nothing;
