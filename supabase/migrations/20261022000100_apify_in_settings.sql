-- The Apify token moves into the app: Settings > Apify, saved as connections key "apify"
-- (data.token). The LinkedIn comments job and the Post numbers job read it from there first and
-- fall back to the APIFY_TOKEN secret in GitHub Actions. The app writes it and never reads it back.
alter table public.connections drop constraint connections_key_check;
alter table public.connections add constraint connections_key_check
  check (key in ('wonderreel', 'calendar_feed', 'google', 'google_state', 'linkedin_profile', 'apify'));
