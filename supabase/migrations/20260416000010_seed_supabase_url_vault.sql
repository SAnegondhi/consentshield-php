-- N-S3 follow-on: seed the `supabase_url` Vault secret that migration
-- 20260416000009_cron_url_via_vault.sql now expects.
--
-- The URL itself is NOT secret — it appears in browser-side env vars and
-- in the older cron migrations. Putting it into Vault is purely a
-- parametrisation play so future cron migrations have a single source of
-- truth instead of a hardcoded literal per file.
--
-- Idempotent: skip if the secret already exists.

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'supabase_url'
  ) then
    perform vault.create_secret(
      'https://xlqiakmkdjycfiioslgs.supabase.co',
      'supabase_url',
      'Supabase project URL for pg_cron HTTP targets (N-S3, 2026-04-16)'
    );
  end if;
end $$;
