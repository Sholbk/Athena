-- Her WonderReel connect link (WonderReel Pro, "Claude MCP Access"), so Media can import her
-- newest WonderReel images and videos without a download and upload.
-- The link carries her personal WonderReel key. The app saves it but never reads it back;
-- the wonderreel-gallery edge function reads it with her login, so only she can use it.
create table public.connections (
  key text primary key check (key in ('wonderreel')),
  url text not null,
  updated_at timestamptz not null default now()
);
alter table public.connections enable row level security;
create policy "owner all" on public.connections for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
