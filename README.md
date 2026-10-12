# Athena

Stephanie's Chief of Staff app for operations and marketing. React on Netlify, Supabase for login and data, two-way sync with the Obsidian vault ([Sholbk/athena-vault](https://github.com/Sholbk/athena-vault)).

## What is built

- Sign in with Google. Only emails in the `allowed_users` table get in.
- Today, Tasks and Week views. Add, edit, complete and delete tasks.
- Two-way vault sync every 15 minutes (`sync/sync.py`, run by `.github/workflows/vault-sync.yml`).
- Database tables for briefs, money, content, Rocks, Scorecard, Issues, Level 10, pages, calendar feeds and Athena requests. The screens for those come next.

## One-time setup

### 1. Supabase (project `dgjbzkslgjqsopjzzeqy`)
- Authentication > Sign In / Providers > Google: turn it on and paste the Google client ID and secret (step 2).
- Authentication > URL Configuration: set Site URL to the Netlify address, and add it plus `http://localhost:5173` under Redirect URLs.

### 2. Google sign-in client
- Google Cloud Console > APIs & Services > Credentials > Create credentials > OAuth client ID > Web application.
- Authorized redirect URI: `https://dgjbzkslgjqsopjzzeqy.supabase.co/auth/v1/callback`
- Sign-in only uses basic profile scopes, so Google does not need to review the app.

### 3. Netlify
- Add new site > Import from GitHub > `Sholbk/Athena`. Build settings come from `netlify.toml`.
- Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (values in `.env.example`; both are safe to publish).

### 4. GitHub secrets for the sync (this repo > Settings > Secrets and variables > Actions)
- `SUPABASE_URL`: `https://dgjbzkslgjqsopjzzeqy.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase > Project Settings > API Keys > `service_role` (secret, never put it in Netlify or the app).
- `VAULT_TOKEN`: a fine-grained GitHub token with Contents read and write on `Sholbk/athena-vault` only.

Then run Actions > Vault sync > Run workflow, first with "Only show what would change" ticked, then for real. The first real run imports every vault note.

## Local dev

```
cp .env.example .env.local
npm install
npm run dev
```

## Sync rules

- Changed in Obsidian only: the app copy updates.
- Changed in the app only: the note is rewritten.
- Changed in both: the newer edit wins.
- Deleted in the app: the note is removed. Deleted in Obsidian: the row is removed, unless the app edited it since.
- The job refuses to delete more than half of a table in one run, to protect against a broken checkout.
