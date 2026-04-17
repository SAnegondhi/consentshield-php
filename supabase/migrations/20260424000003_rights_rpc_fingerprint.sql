-- ADR-0037 Sprint 1.2 — extend rpc_rights_request_create with session_fingerprint.
--
-- DROP + CREATE because the signature changes (new trailing parameter
-- with a DEFAULT NULL). Only caller is /api/public/rights-request which
-- is updated in the same ADR sprint.

drop function if exists public.rpc_rights_request_create(
  uuid, text, text, text, text, text, timestamptz
);

create or replace function public.rpc_rights_request_create(
  p_org_id uuid,
  p_request_type text,
  p_requestor_name text,
  p_requestor_email text,
  p_requestor_message text,
  p_otp_hash text,
  p_otp_expires_at timestamptz,
  p_session_fingerprint text default null
)
returns table (request_id uuid, org_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_name   text;
  v_request_id uuid;
begin
  if p_request_type not in ('erasure', 'access', 'correction', 'nomination') then
    raise exception 'invalid request_type: %', p_request_type using errcode = '22023';
  end if;

  if p_requestor_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid requestor_email' using errcode = '22023';
  end if;

  select name into v_org_name from organisations where id = p_org_id;
  if v_org_name is null then
    raise exception 'unknown organisation' using errcode = 'P0002';
  end if;

  insert into rights_requests (
    org_id, request_type, requestor_name, requestor_email, requestor_message,
    turnstile_verified, email_verified, otp_hash, otp_expires_at, status,
    session_fingerprint
  ) values (
    p_org_id, p_request_type, p_requestor_name, p_requestor_email, p_requestor_message,
    true, false, p_otp_hash, p_otp_expires_at, 'new',
    p_session_fingerprint
  ) returning id into v_request_id;

  return query select v_request_id, v_org_name;
end;
$$;

alter function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz, text)
  owner to cs_orchestrator;
revoke all on function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz, text) from public;
grant execute on function public.rpc_rights_request_create(uuid, text, text, text, text, text, timestamptz, text) to anon;
