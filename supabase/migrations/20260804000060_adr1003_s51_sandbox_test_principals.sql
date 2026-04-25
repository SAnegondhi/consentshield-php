-- ADR-1003 Sprint 5.1 — sandbox test-principal generator (round 2 of 3).
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Scope this round:
--   (1) Per-org sequence table public.sandbox_test_principal_counters
--       (org_id pk + next_seq bigint).
--   (2) public.rpc_sandbox_next_test_principal(p_org_id uuid) — atomic
--       fetch-and-increment that returns the next identifier as a
--       string `cs_test_principal_<seq>`. SECURITY DEFINER. Refuses
--       non-sandbox orgs (raises 42501). Runtime call surface for the
--       /api/v1/_sandbox/test-principals endpoint.
--   (3) Forward-promise: any future cross-customer aggregator over
--       depa_compliance_metrics MUST filter to non-sandbox orgs. Today
--       no such aggregator exists, but Sprint 5.1's deliverable says
--       "Compliance score endpoint excludes sandbox orgs from any
--       cross-customer metric." We satisfy it with a stable view
--       public.depa_compliance_metrics_prod that filters out sandbox
--       orgs, so the convention is named at the schema layer rather
--       than left as a code-side gentleman's agreement. cs_admin gets
--       SELECT (admin-side benchmarking surfaces will read from this
--       view, never the raw table).
--
-- No write paths granted to authenticated; the counter table is
-- mutated only via the RPC (cs_orchestrator EXECUTE for the customer-
-- app surface).

-- ─────────────────────────────────────────────────────────────────────
-- 1. public.sandbox_test_principal_counters
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.sandbox_test_principal_counters (
  org_id    uuid primary key references public.organisations(id) on delete cascade,
  next_seq  bigint not null default 1 check (next_seq >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.sandbox_test_principal_counters is
  'ADR-1003 Sprint 5.1 R2. Per-sandbox-org monotonic counter for the '
  'test-principal generator. Mutated only by '
  'public.rpc_sandbox_next_test_principal — never directly by '
  'authenticated.';

alter table public.sandbox_test_principal_counters enable row level security;

-- No customer-side direct read or write; everything routes through the
-- RPC. cs_orchestrator gets full mutation rights for the RPC body.
revoke all on public.sandbox_test_principal_counters from public, authenticated, anon;
grant select, insert, update on public.sandbox_test_principal_counters to cs_orchestrator;

-- ─────────────────────────────────────────────────────────────────────
-- 2. public.rpc_sandbox_next_test_principal(p_org_id uuid)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.rpc_sandbox_next_test_principal(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_sandbox boolean;
  v_seq        bigint;
begin
  if p_org_id is null then
    raise exception 'org_id_missing' using errcode = '22023';
  end if;

  select coalesce(sandbox, false) into v_is_sandbox
    from public.organisations
   where id = p_org_id;

  if v_is_sandbox is null or v_is_sandbox = false then
    raise exception 'not_a_sandbox_org' using errcode = '42501';
  end if;

  -- Atomic fetch-and-increment. Two-step pattern:
  --   1. Ensure a row exists for this org (idempotent insert).
  --   2. Bump next_seq and return the post-bump value minus 1 as the
  --      seq we hand back. Both steps run in this RPC's transaction.
  -- next_seq column semantics: "the value to return on the NEXT call".
  insert into public.sandbox_test_principal_counters (org_id)
  values (p_org_id)
  on conflict (org_id) do nothing;

  update public.sandbox_test_principal_counters
     set next_seq   = next_seq + 1,
         updated_at = now()
   where org_id = p_org_id
   returning next_seq - 1 into v_seq;

  return jsonb_build_object(
    'identifier', 'cs_test_principal_' || lpad(v_seq::text, 6, '0'),
    'seq',        v_seq
  );
end;
$$;

revoke all on function public.rpc_sandbox_next_test_principal(uuid) from public;
grant execute on function public.rpc_sandbox_next_test_principal(uuid) to cs_orchestrator;

comment on function public.rpc_sandbox_next_test_principal(uuid) is
  'ADR-1003 Sprint 5.1 R2. Returns the next test-principal identifier '
  '(`cs_test_principal_NNNNNN`) for a sandbox org. Atomic per-org '
  'sequence. Refuses non-sandbox orgs with 42501.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. public.depa_compliance_metrics_prod (view) — non-sandbox only.
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 5.1 spec: "Compliance score endpoint excludes sandbox orgs
-- from any cross-customer metric". We satisfy by exposing this filtered
-- view; any aggregator (admin benchmarks, percentile rankings, etc.)
-- reads from this view, NOT from the raw depa_compliance_metrics
-- table. The customer-facing /v1/score endpoint is unaffected — it
-- reads the per-org row directly, so a sandbox org still sees its own
-- score in the dashboard.

create or replace view public.depa_compliance_metrics_prod as
  select dcm.*
    from public.depa_compliance_metrics dcm
    join public.organisations o on o.id = dcm.org_id
   where coalesce(o.sandbox, false) = false;

comment on view public.depa_compliance_metrics_prod is
  'ADR-1003 Sprint 5.1 R2. Production-only projection of '
  'depa_compliance_metrics — sandbox orgs are filtered out. Any '
  'cross-customer aggregator (benchmarks, percentile rankings, '
  'admin tiles that average across orgs) reads from this view rather '
  'than the raw table. The customer-facing per-org score endpoint '
  '(/v1/score) is unaffected.';

grant select on public.depa_compliance_metrics_prod to cs_admin;

-- Verification:
--   -- Counter table:
--     \d+ public.sandbox_test_principal_counters
--   -- RPC:
--     select pg_get_functiondef('public.rpc_sandbox_next_test_principal(uuid)'::regprocedure);
--   -- Live happy path against a known sandbox org (replace org_id):
--     select public.rpc_sandbox_next_test_principal('<sandbox_org_id>'::uuid);
--     -- expected: {identifier: 'cs_test_principal_000001', seq: 1} the first call,
--     -- {identifier: 'cs_test_principal_000002', seq: 2} on the second.
--   -- Refusal on a non-sandbox org:
--     select public.rpc_sandbox_next_test_principal('<prod_org_id>'::uuid);
--     -- expected: ERROR 42501 not_a_sandbox_org.
