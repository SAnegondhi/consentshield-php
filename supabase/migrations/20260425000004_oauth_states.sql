-- ADR-0039 Sprint 1.1 — oauth_states table for OAuth handshake CSRF protection.
--
-- Populated on GET /api/integrations/oauth/<provider>/connect before
-- redirecting to the provider; consumed on GET .../callback. Rows auto-expire
-- after 10 minutes. A cleanup cron deletes consumed + expired rows hourly.

create table oauth_states (
  state       text primary key,
  org_id      uuid not null references organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  provider    text not null,
  redirect_uri text not null,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz,
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

create index idx_oauth_states_expiry on oauth_states (expires_at);

-- No RLS. The connect/callback routes run as service role (orchestrator)
-- because the state token IS the auth for the callback. Customers never
-- query this table.
alter table oauth_states enable row level security;

-- Explicit deny-all for authenticated. Only service role can read/write.
create policy "none" on oauth_states for all using (false) with check (false);

grant select, insert, update on oauth_states to cs_orchestrator;

comment on table oauth_states is
  'ADR-0039. Short-lived CSRF tokens for OAuth handshakes. Inserted at '
  'connect time; consumed at callback time; cleaned up by an hourly cron. '
  'No customer-facing RLS — routes use service role.';

-- ═══════════════════════════════════════════════════════════
-- oauth_states_cleanup() — deletes consumed + expired rows.
-- ═══════════════════════════════════════════════════════════
create or replace function public.oauth_states_cleanup()
returns integer language plpgsql security definer as $$
declare
  n integer;
begin
  delete from oauth_states
   where consumed_at is not null
      or expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.oauth_states_cleanup() to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: oauth-states-cleanup-hourly at :23 past the hour.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('oauth-states-cleanup-hourly');
exception when others then null; end $$;

select cron.schedule(
  'oauth-states-cleanup-hourly',
  '23 * * * *',
  $$select public.oauth_states_cleanup()$$
);
