# Athena status

Last updated Oct 14, 2026.

## Live

App: https://athenaprojectmanager.netlify.app (Netlify site `athenaprojectmanager`, builds from `main`).
Supabase project: `dgjbzkslgjqsopjzzeqy` (named Athena).

| Area | State |
| --- | --- |
| Google sign-in, owner allowlist | Done |
| Two-way Obsidian vault sync (`sync/sync.py`, Vault sync workflow). The database clock starts it every 15 min (`athena_vault_sync`, signed with Vault key `athena_cron_key`); GitHub's own schedule is the backup | Done, running |
| Today, Tasks, Week | Done |
| Daily brief card on Today | Done |
| Marketing: pipeline, calendar, idea bank, brand files | Done |
| Athena chat and "Ask Athena to draft this" (`athena/`, Athena workflow, `athena-dispatch` edge function) | Done, tested end to end Oct 12 |
| EOS: Rocks, Scorecard, Issues, Level 10, V/TO | Done |
| Athena's jobs in the app, Settings (schedule, instructions, calendar links), calendar on Week | Done Oct 14 |
| Library tab: the AI Bootcamp notes from the vault's `AI Bootcamp` folder, to search and read (edits happen in Obsidian) | Done Oct 15 |
| Call to-dos: Granola calls sync into the vault's `Meetings` folder (Obsidian plugin). Athena turns her to-dos into tasks (rules in `athena/CALLS.md`, log page "Calls read"), each weekday morning before the brief or when asked in chat | Done Oct 15 |
| Marketing > Media: her own photos and finished posts in the private Storage bucket `media` (table `media`, migration applied by hand in the SQL editor because the project sits in the Dragonfly Free Accounts org). Photos shrink to 2048 px; free plan is 1 GB, 50 MB a file. Athena reads titles and tags | Done Oct 16 |
| Idea bank image prompts: per seed, a ChatGPT prompt (the picture) and a Claude prompt (PNG slides). Athena writes them on request (rules in `athena/IMAGES.md`, 12 seeds a run) into the page "Image prompts"; the Idea bank reads that page | Done Oct 16 |

## Secrets in place

- GitHub Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_TOKEN` (fine-grained, athena-vault contents rw), `CLAUDE_CODE_OAUTH_TOKEN`.
- Supabase Edge Function secret: `GITHUB_DISPATCH_TOKEN` (fine-grained, Sholbk/Athena contents rw).
- Netlify env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Athena's jobs (run inside the app)

Nothing runs in claude.ai. The four claude.ai routines were retired Oct 14.

| Job | When (Mountain) | Where it lands |
| --- | --- | --- |
| Daily brief | Tue to Fri, 7:58 AM | `pages` row "Daily brief" (folder Athena), Today page |
| Monday plan | Mon, 6:55 AM | new `briefs` row, Today page |
| Friday wrap | Fri, 3:58 PM | new `briefs` row, Today page |
| Level 10 with Metis | Start Level 10 button (EOS page or Settings) | Athena tab conversation; Metis writes Rocks, Scorecard, Issues, Level 10 and tasks |

How it runs: `pg_cron` calls `athena_tick()` every 5 minutes. A job fires once a day, inside 90 minutes of its time, on its days. It inserts an `athena_requests` row with `job` set and `pg_net` calls `athena-dispatch`, which starts the Athena workflow. `athena/answer.py` runs it and saves the result. Run now buttons take the same path from the app.

- Instructions live in `athena_jobs.prompt`, edited in the app under Settings. They are not in this repo because they carry private business detail.
- Times, days and on/off are in Settings too.
- Vault secrets `athena_project_url` and `athena_anon_key` let the database call the edge function; `athena_cron_key` signs its vault sync calls.
- On Stephanie's Mac, Obsidian opens `~/Documents/GitHub/athena-vault` and the Obsidian Git plugin pulls and pushes every 5 minutes.
- Calendar: private Google Calendar iCal links in `calendar_feeds` (Settings). The briefs read them in `athena/calendar_feed.py`; the Week page reads them through the `calendar-events` edge function. The links are never shown back in the app.

## Known limits

- Athena cannot read Gmail. The briefs say so instead of guessing.
- Chat replies and job runs take 1 to 3 minutes, mostly GitHub runner start-up.
- Older Supabase tables from the colibri-internal days are untouched: `inbox_items`, `inbox_senders`, `eos_snapshots`.

## Ideas for next time

- Faster chat start-up.
- Decide whether NotebookLM and any Cowork desktop schedules can be retired.
