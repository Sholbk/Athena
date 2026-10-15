-- More private connections for her calendar, kept in the owner-only connections table:
--   calendar_feed  data.token: the secret in her posting-days calendar link, which Google
--                  Calendar subscribes to (edge function athena-calendar-feed).
--   google         data: her Google OAuth client and refresh token, so Athena can add events
--                  to her Google Calendar when she asks (athena/gcal.py, edge function google-oauth).
--   google_state   data.state: a one-time value that ties Google's sign-in reply to her click.
-- The app writes these but never reads the secret parts back.
alter table public.connections drop constraint connections_key_check;
alter table public.connections add constraint connections_key_check
  check (key in ('wonderreel', 'calendar_feed', 'google', 'google_state'));
alter table public.connections alter column url drop not null;
alter table public.connections add column data jsonb;
