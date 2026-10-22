-- Viral Outlier Review: which recent Instagram reels from the accounts she watches did far better
-- than usual, on its own page at /outliers.
--
-- The job "Viral Outlier Review" (athena/outliers.py) runs Mondays at 6:30 AM through the same
-- clock as every other job. It needs no Claude: answer.py runs the script directly. It reads the
-- last 14 days of reels through Apify with her token from Settings > Apify (connections key
-- "apify", never read back by the page), marks the outliers, and gets the spoken transcript for
-- the outliers only. Nothing here posts, likes, comments or follows anywhere.
--
-- Neither table syncs to Obsidian (sync.py works from a fixed list).

create table public.outlier_accounts (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,            -- the profile link as she gave it
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.outlier_accounts enable row level security;
create policy "owner all" on public.outlier_accounts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

insert into public.outlier_accounts (url, label) values
  ('https://www.instagram.com/mindbody/', 'mindbody'),
  ('https://www.instagram.com/ivorey.io/', 'ivorey.io'),
  ('https://www.instagram.com/funnelgorgeous/', 'funnelgorgeous')
on conflict (url) do nothing;

-- One row per reel seen in the latest run. Rows the latest run did not see are soft deleted,
-- so the page always shows the current 14 days. Transcripts stay on the row and are reused.
create table public.outlier_reels (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique,
  account_url text,                    -- which watched account it came from
  creator text not null,               -- the Instagram username on the reel today
  url text not null,
  posted_at timestamptz not null,
  views int,
  likes int,
  comments int,
  duration_s numeric,
  caption text,
  transcript text,
  hook text,                           -- first sentence of the transcript (or of the caption)
  hook_from text check (hook_from in ('transcript', 'caption')),
  creator_median int,                  -- that creator's median views over the window
  times_usual numeric,                 -- views / creator_median
  is_outlier boolean not null default false,
  outlier_reason text,                 -- 'likes', 'views' or 'both'
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.outlier_reels enable row level security;
create policy "owner all" on public.outlier_reels for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index outlier_reels_rank on public.outlier_reels (is_outlier, times_usual desc);

-- The job. On, because she asked for it to refresh by itself every Monday morning.
-- The page also has a Refresh now button.
insert into public.athena_jobs (key, title, kind, days, run_at, enabled, prompt) values (
  'outlier_review', 'Viral Outlier Review', 'report', '{1}', '06:30', true,
  'This job runs a script (athena/outliers.py) and has no instructions to edit. Change the watched accounts in the table outlier_accounts.'
) on conflict (key) do nothing;
