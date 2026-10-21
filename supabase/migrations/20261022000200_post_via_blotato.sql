-- Send to Blotato: she can send a finished piece to her Blotato accounts from the content drawer
-- (post now or schedule). The edge function blotato-post does the sending with her Blotato key,
-- saved in Settings > Blotato (connections key "blotato", data.token, never read back by the page).
-- Each send is one row here per account, so the drawer can show its state and Results can tie
-- the numbers back once it is published. Athena (the Claude runs) still never posts: this is her click.
--
-- Not synced to Obsidian (sync.py works from a fixed list).

alter table public.connections drop constraint connections_key_check;
alter table public.connections add constraint connections_key_check
  check (key in ('wonderreel', 'calendar_feed', 'google', 'google_state', 'linkedin_profile', 'apify', 'blotato'));

create table public.post_submissions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content(id) on delete cascade,
  account_id text not null,            -- Blotato account id
  platform text not null,
  page_id text,                        -- LinkedIn company page, when posting as the page
  account_name text,
  submission_id text not null unique,  -- Blotato postSubmissionId
  scheduled_time timestamptz,          -- null = posted right away
  status text not null default 'in-progress'
    check (status in ('in-progress', 'scheduled', 'published', 'failed', 'cancelled')),
  public_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.post_submissions enable row level security;
create policy "owner all" on public.post_submissions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index post_submissions_content on public.post_submissions (content_id, created_at desc);

-- A media file uploaded to Blotato once keeps its Blotato link, so a retry does not upload it again.
alter table public.media add column blotato_url text;
