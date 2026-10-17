-- LinkedIn comment-first warm-up for ColibriOS, on the Marketing page as "Comment desk".
--
-- Stephanie keeps a short list of people worth being seen by (linkedin_people). On weekday
-- mornings the job "LinkedIn comments" reads their newest public posts through Apify
-- (athena/linkedin.py, secret APIFY_TOKEN in GitHub Actions), and Athena drafts one comment
-- per good post (linkedin_comments). Stephanie copies, edits and posts every comment herself
-- on LinkedIn, then presses "I posted it". The app never touches LinkedIn.
--
-- Neither table syncs to Obsidian (sync.py works from a fixed list).

create table public.linkedin_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  company text,
  url text not null unique,            -- https://www.linkedin.com/in/<slug>/
  tier int not null default 1 check (tier in (1, 2)),   -- 1 = who she most wants to be seen by
  score int not null default 0,        -- higher first when more qualify than fit a run
  stage text not null default 'Watching'
    check (stage in ('Watching', 'Commented', 'Connected', 'Replied', 'Stop')),
  notes text,
  last_scanned_on date,                -- Mountain date of the last Apify scan that included them
  last_post_on date,                   -- newest public post the scan saw
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.linkedin_people enable row level security;
create policy "owner all" on public.linkedin_people for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create table public.linkedin_comments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.linkedin_people(id) on delete cascade,
  post_url text not null unique,
  post_key text not null unique,       -- "a" + the digits after "activity-" in the post link
  post_date date not null,
  staged_on date not null,             -- Mountain date Athena drafted it
  kind text not null default 'staged' check (kind in ('staged', 'tier2')),  -- tier2 extras do not count toward the batch
  summary text not null,               -- 1 to 2 sentences on what the post says, Athena's words
  comment text not null,               -- the draft she copies
  posted_at timestamptz,               -- set by "I posted it"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz               -- the job retires unposted drafts once the post is older than 14 days
);
alter table public.linkedin_comments enable row level security;
create policy "owner all" on public.linkedin_comments for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create index linkedin_comments_person on public.linkedin_comments (person_id);

-- The job. Off until Stephanie turns it on in Settings. The Comment desk also has a Run now button.
-- The instructions below carry nothing private (the audience is what colibrios.com says), so they
-- can live here; she edits them in Settings like the other jobs.
insert into public.athena_jobs (key, title, kind, days, run_at, enabled, prompt) values (
  'linkedin_comments', 'LinkedIn comments', 'report', '{1,2,3,4,5}', '07:20', false,
$prompt$You are Athena. This run gets Stephanie ready to leave real comments on recent LinkedIn posts by people she wants to be seen by, so a connection request is never the first time they see her name. You find the posts and draft one comment each. She copies, edits and posts every comment herself and sends every connection request herself. Follow "LinkedIn comments" below for the tools, the steps, the comment rules and the brief.

## Who she wants to be seen by

Tier 1, the people the comments are for: solo practitioners who run their own practice and sell bookings, group sessions, events or retreats. In this order: breathwork, sound healing, retreat hosts, dance and movement, ceremony and shamanic work, and coaches last. Also the people they listen to: teachers and trainers who certify these practitioners.

Tier 2, extras: studio and space owners, event creators, and community builders in the healing and wellness space.

Skip: marketers, agencies, software companies, virtual assistants, recruiters, anyone selling to the same practitioners, and anyone whose post is a job ad, a logistics announcement or a pure repost.

## Her voice in a comment

Warm, practical, simple words, short sentences, no hype. She has run her own business for years and has set up the bookings, sessions and books for many practitioners, so she can speak to the craft of running a solo practice. Lead with a point of view about the subject of the post, give one plain reason, then at most one light question. Never name ColibriOS or any product. Never pitch. Never praise the person.

## Batch

Batch 1 started on 2026-10-17. The batch target is 30 staged comments. Stage up to 6 tier 1 comments a run and up to 3 tier 2 extras. Spend cap for the Apify scan: $1.00 a run.$prompt$
) on conflict (key) do nothing;
