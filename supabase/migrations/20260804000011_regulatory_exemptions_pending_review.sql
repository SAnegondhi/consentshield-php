-- ADR-1004 Sprint 1.6 — default state: "pending legal review" for every
-- seed row + future per-org overrides until counsel is engaged.
--
-- Contract: `reviewed_at IS NULL` IS the authoritative "not yet reviewed"
-- signal. Application surfaces (dashboard, audit export, /v1/* if added
-- later) read that column and render a "pending legal review" badge.
-- When counsel signs off, ADR-1004 Sprint 1.6 close-out will UPDATE
-- reviewed_at + reviewer_name + reviewer_firm + legal_review_notes per
-- reviewed row.
--
-- This migration backfills legal_review_notes with an explicit
-- engineer-drafted marker on every row whose reviewed_at is null, so
-- direct DB inspection is equally unambiguous.

update public.regulatory_exemptions
   set legal_review_notes = coalesce(
         legal_review_notes,
         'PENDING_LEGAL_REVIEW (ADR-1004 Sprint 1.6). '
         || 'Citation and retention_period drafted by the engineering '
         || 'team from the referenced primary source; NOT reviewed by '
         || 'Indian regulatory counsel. Dashboard renders this row with '
         || 'a "pending legal review" badge. Do not rely on this rule '
         || 'for customer-facing advice until reviewed_at is non-null.'
       )
 where reviewed_at is null;

-- Make the contract readable from psql too.
comment on column public.regulatory_exemptions.reviewed_at is
  'ADR-1004 Sprint 1.6 contract — NULL means the rule is still a '
  'pending-legal-review default (engineer-drafted citation). Non-null '
  'means counsel has signed off; reviewer_name + reviewer_firm are '
  'populated alongside.';

comment on column public.regulatory_exemptions.legal_review_notes is
  'Free-text reviewer notes when reviewed_at is non-null, or the '
  'PENDING_LEGAL_REVIEW marker written by migration '
  '20260804000011 otherwise.';
