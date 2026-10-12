-- Athena core schema.
-- One owner app. Every table mirrors a folder in the Obsidian vault (Sholbk/athena-vault).
-- Shared sync columns on every table:
--   vault_path   the note's path in the vault, null until the sync job writes it
--   extra        frontmatter fields the app does not model yet, kept so nothing is lost
--   synced_hash  hash of the note file at the last sync
--   synced_at    when the sync job last matched this row to its file
--   updated_at   bumped on every app edit, compared with synced_at to spot app changes
--   deleted_at   soft delete, so the sync job can remove the note too

-- Who may sign in. Add rows here to let someone in.
create table public.allowed_users (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.allowed_users enable row level security;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

create policy "owners read allowlist" on public.allowed_users
  for select to authenticated using (public.is_owner());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The sync job sets synced_at in the same write; leave updated_at alone then,
  -- so a sync write never looks like an app edit.
  if tg_op = 'UPDATE' and new.synced_at is distinct from old.synced_at then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'Not started'
    check (status in ('Not started','In progress','Waiting on someone','Done','Dropped')),
  priority text check (priority in ('Today','This week','Backlog')),
  bucket text check (bucket in ('Client work','ColibriOS','Gray Bear','DiscoverSWNM','Admin','Personal')),
  client text check (client in ('SENERGY360','Vive Management','Loma del Mar','ColibriOS','Dragonfly','None')),
  source text check (source in ('Meeting','Email','Brief','Stephanie','Athena')),
  eos_flag text check (eos_flag in ('Off track Rock','Off pace measurable','Rolled twice','L10 to-do')),
  due date,
  est_hours numeric(6,2),
  serves_rock text[] not null default '{}',
  notes text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Briefs
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text check (type in ('Monday plan','Wednesday check','Friday wrap','Monthly review')),
  week_of date,
  client_hours numeric(6,2),
  colibrios_hours numeric(6,2),
  decision_needed text,
  gone_quiet text,
  carry_over text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Money
create table public.money (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text check (kind in ('Invoice','Pipeline','Recurring')),
  status text check (status in ('Draft','Sent','Paid','Overdue','Open','Won','Lost')),
  client text,
  amount numeric(12,2),
  sent date,
  due date,
  last_nudge date,
  notes text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Content (marketing calendar)
create table public.content (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'Idea'
    check (status in ('Idea','Drafted','Awaiting approval','Scheduled','Shipped','Skipped')),
  channel text,
  product text,
  target_date date,
  cta text,
  notes text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Rocks (Metis)
create table public.rocks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  quarter text check (quarter in ('Q3 2026','Q4 2026','Q1 2027','Q2 2027')),
  status text check (status in ('On track','Off track','Done')),
  owner text,
  due date,
  athena_tasks text[] not null default '{}',
  notes text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Scorecard (Metis). One row per week, named by week-ending date.
-- Measurables live in metrics as {"Beta testers active": 13, ...} so new ones need no migration.
create table public.scorecard (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  week_ending date unique,
  metrics jsonb not null default '{}',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Issues List (Metis)
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  priority smallint check (priority between 1 and 4),
  status text not null default 'Open' check (status in ('Open','Solved','Parked')),
  owner text,
  raised date,
  solved_on date,
  solution text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Level 10 Log (Metis)
create table public.l10 (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  meeting_date date,
  rating numeric(4,1),
  issue_solved text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Free-form pages: Athena.md, brand files, marketing plan, V/TO, ship log.
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  folder text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vault_path text unique,
  extra jsonb not null default '{}',
  synced_hash text,
  synced_at timestamptz,
  deleted_at timestamptz
);

-- Private Google Calendar iCal links. Read-only planning feed, never synced to the vault.
create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ical_url text not null,
  color text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Messages to Athena. The app inserts a request, a GitHub Action running Claude Code answers it.
create table public.athena_requests (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null default gen_random_uuid(),
  message text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  reply text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Same owner-only policy and updated_at trigger everywhere.
do $$
declare t text;
begin
  foreach t in array array['tasks','briefs','money','content','rocks','scorecard','issues','l10','pages','calendar_feeds','athena_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner all" on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
  foreach t in array array['tasks','briefs','money','content','rocks','scorecard','issues','l10','pages']
  loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('create index on public.%I (updated_at)', t);
  end loop;
end $$;

create index on public.tasks (status, due);
create index on public.content (status, target_date);
create index on public.athena_requests (status, created_at);
