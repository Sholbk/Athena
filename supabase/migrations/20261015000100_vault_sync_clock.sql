-- Run the vault sync every 15 minutes from the database clock.
-- GitHub's own schedule for the Vault sync workflow fires hours apart, so Obsidian and the
-- app drifted. The clock asks athena-dispatch to send a vault-sync event, signing the call
-- with a key that lives only in Supabase Vault, so nobody else can trigger syncs.

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'athena_cron_key',
  'Athena: proves a dispatch call came from the database clock');

-- athena-dispatch checks the key with this. Only the service role may call it.
create or replace function public.athena_cron_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'athena_cron_key' and decrypted_secret = p_key);
$$;
revoke all on function public.athena_cron_key_ok(text) from public, anon, authenticated;
grant execute on function public.athena_cron_key_ok(text) to service_role;

create or replace function public.athena_vault_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'athena_project_url');
  v_anon text := (select decrypted_secret from vault.decrypted_secrets where name = 'athena_anon_key');
  v_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'athena_cron_key');
begin
  if v_url is null or v_anon is null or v_key is null then
    raise warning 'athena_vault_sync: a Vault secret is missing';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/athena-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon,
                                  'apikey', v_anon, 'x-athena-key', v_key),
    body := jsonb_build_object('vault_sync', true)
  );
end;
$$;
revoke all on function public.athena_vault_sync() from public, anon, authenticated;

select cron.schedule('athena-vault-sync', '*/15 * * * *', 'select public.athena_vault_sync()');
