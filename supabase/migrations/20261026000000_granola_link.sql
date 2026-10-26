-- Granola straight into the app, without Obsidian open.
--   granola        data: the Granola sign-in made by Settings > Granola (client_id, refresh_token,
--                  access_token, expires_at, email, connected_at) plus what the last pull did
--                  (status, last_run_at, last_added, seen). athena/granola.py reads it in the
--                  Vault sync run and saves new calls as pages in the Meetings folder.
--   granola_state  data: a one-time value, the code verifier and the client id that tie
--                  Granola's sign-in reply to her click in Settings.
-- The app writes these but never reads the secret parts back.
alter table public.connections drop constraint connections_key_check;
alter table public.connections add constraint connections_key_check
  check (key in ('wonderreel', 'calendar_feed', 'google', 'google_state', 'linkedin_profile', 'apify', 'blotato',
                 'granola', 'granola_state'));
