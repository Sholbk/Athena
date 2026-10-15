-- Athena's scheduled jobs run from the app, not from claude.ai.
-- The database keeps the clock (pg_cron). Every 5 minutes athena_tick() queues any job
-- that is due in Mountain time, and pg_net asks the athena-dispatch edge function to start
-- the Athena workflow, the same path a chat message takes.
--
-- Job instructions live in athena_jobs.prompt, never in this repo, because they carry
-- private business detail. Edit them in the app under Settings.
--
-- Dispatch needs two Supabase Vault secrets, set once by hand:
--   athena_project_url  https://<ref>.supabase.co
--   athena_anon_key     the legacy anon key (already public in the app bundle)

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.athena_jobs (
  key text primary key,
  title text not null,
  -- report: Athena writes a document the app saves (daily brief, Monday plan, Friday wrap).
  -- meeting: a conversation in the Athena tab (Level 10 with Metis).
  kind text not null default 'report' check (kind in ('report','meeting')),
  prompt text not null default '',
  days int[] not null default '{}',   -- ISO weekdays, 1 = Monday, 7 = Sunday
  run_at time,                        -- Mountain time. Null means it only runs from a button.
  enabled boolean not null default false,
  last_queued_on date,                -- Mountain date of the last run, timed or Run now
  last_request_id uuid,
  updated_at timestamptz not null default now()
);
alter table public.athena_jobs enable row level security;
create policy "owner all" on public.athena_jobs for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

alter table public.athena_requests
  add column job text references public.athena_jobs(key) on update cascade on delete set null;

-- Every job request stamps its job. A Run now at 7:00 AM therefore skips that morning's
-- timed run, and Settings can show when each job last ran.
create or replace function public.athena_job_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job is not null then
    update public.athena_jobs
       set last_queued_on = (now() at time zone 'America/Denver')::date,
           last_request_id = new.id
     where key = new.job;
  end if;
  return new;
end;
$$;
create trigger athena_job_stamp after insert on public.athena_requests
  for each row execute function public.athena_job_stamp();

-- Asks the athena-dispatch edge function to start the Athena workflow for one request.
create or replace function public.athena_dispatch(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'athena_project_url');
  v_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'athena_anon_key');
begin
  if v_url is null or v_key is null then
    raise warning 'athena_dispatch: athena_project_url or athena_anon_key is missing from Vault';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/athena-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
    body := jsonb_build_object('request_id', p_request)
  );
end;
$$;

-- Queues every job that is due now in Mountain time. A job fires at most once a day, and
-- only inside 90 minutes of its time, so a stalled clock never sends a morning brief at 5 PM.
create or replace function public.athena_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'America/Denver';
  v_id uuid;
  j record;
begin
  for j in
    select key, title from public.athena_jobs
     where enabled
       and run_at is not null
       and extract(isodow from v_now)::int = any(days)
       and v_now::time >= run_at
       and v_now::time < run_at + interval '90 minutes'
       and (last_queued_on is null or last_queued_on < v_now::date)
     for update skip locked
  loop
    insert into public.athena_requests (message, job) values ('Scheduled: ' || j.title, j.key)
      returning id into v_id;
    perform public.athena_dispatch(v_id);
  end loop;
end;
$$;

revoke all on function public.athena_job_stamp() from public, anon, authenticated;
revoke all on function public.athena_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.athena_tick() from public, anon, authenticated;

select cron.schedule('athena-tick', '*/5 * * * *', 'select public.athena_tick()');
