-- Weekly social scorecard (her spec, Oct 22): the Social Media page pulls her own posts from the last
-- 30 days through Apify on Instagram, Facebook and LinkedIn (her profile and the ColibriOS page),
-- scores each one against her median for that platform, and saves her follower counts each week.
--
-- A new script-only job "Social scorecard" (athena/stats.py scorecard, no Claude) runs Fridays at
-- 7:00 AM, on because she asked for it. The Post numbers job stays exactly as she set it.

-- Which of her accounts a post came from, so the page can tell her profile from the ColibriOS page.
alter table public.posts add column account_id uuid references public.social_accounts(id) on delete set null;
create index posts_account on public.posts (account_id);

insert into public.social_accounts (platform, url, label) values
  ('facebook', 'https://www.facebook.com/profile.php?id=61595038786783', 'Facebook'),
  ('linkedin', 'https://www.linkedin.com/company/colibri-os/', 'LinkedIn page')
on conflict (url) do nothing;

insert into public.athena_jobs (key, title, kind, days, run_at, enabled, prompt) values (
  'social_scorecard', 'Social scorecard', 'report', '{5}', '07:00', true,
  'This job runs a script (athena/stats.py scorecard) and has no instructions to edit. Change the accounts in the table social_accounts.'
) on conflict (key) do nothing;
