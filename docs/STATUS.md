# Athena status

Last updated Oct 12, 2026.

## Live

App: https://athenaprojectmanager.netlify.app (Netlify site `athenaprojectmanager`, builds from `main`).
Supabase project: `dgjbzkslgjqsopjzzeqy` (named Athena).

| Area | State |
| --- | --- |
| Google sign-in, owner allowlist | Done |
| Two-way Obsidian vault sync, every 15 min (`sync/sync.py`, Vault sync workflow) | Done, running |
| Today, Tasks, Week | Done |
| Daily brief card on Today | Done |
| Marketing: pipeline, calendar, idea bank, brand files | Done |
| Athena chat and "Ask Athena to draft this" (`athena/`, Athena workflow, `athena-dispatch` edge function) | Done, tested end to end Oct 12 |
| EOS: Rocks, Scorecard, Issues, Level 10, V/TO | Done |

## Secrets in place

- GitHub Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_TOKEN` (fine-grained, athena-vault contents rw), `CLAUDE_CODE_OAUTH_TOKEN`.
- Supabase Edge Function secret: `GITHUB_DISPATCH_TOKEN` (fine-grained, Sholbk/Athena contents rw).
- Netlify env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Scheduled routines that feed the app (claude.ai cloud routines)

These write into the vault, and the sync brings their output in. They read Gmail and Calendar, which the app cannot.

- Athena Daily Brief (vault): Tue to Fri, 7:58 AM MT, replaces `Athena/Daily brief.md`
- Athena Monday Kickoff (vault): Mon, 6:55 AM MT
- Athena Friday Wrap (vault): Fri, 3:58 PM MT
- Metis Friday Level 10: Fri, 9:00 AM MT (cron in UTC, drifts to 8:00 AM after Nov 1 DST change)

The old, disabled copies of the three Athena routines were deleted Oct 12.

## Known limits

- Chat Athena cannot read Gmail or Google Calendar. The Desk in claude.ai and the scheduled routines can.
- Week view has no calendar events yet. Planned approach: paste private Google Calendar iCal links into `calendar_feeds`.
- Chat replies take 1 to 3 minutes, mostly GitHub runner start-up.
- Older Supabase tables from the colibri-internal days are untouched: `inbox_items`, `inbox_senders`, `eos_snapshots`.

## Ideas for next time

- Calendar events on Week from iCal links.
- Faster chat start-up.
- Decide whether NotebookLM and any Cowork desktop schedules can be retired (check for duplicates of the cloud routines).
- Metis Level 10 cron: move to `0 16 * * 5` before Nov 6 to hold 9:00 AM MT.
