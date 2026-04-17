-- ADR-0032 Sprint 2.1 — customer-side access to admin.support_tickets.
--
-- Customers cannot SELECT admin.support_tickets directly (the existing
-- support_tickets_admin RLS policy gates on is_admin). This migration
-- adds three SECURITY DEFINER helpers in public that scope access to
-- the current user's org via public.current_org_id():
--
--   public.list_org_support_tickets()        — list tickets for caller's org
--   public.list_support_ticket_messages(id)  — list messages on a ticket if caller is in the ticket's org
--   public.add_customer_support_message(id, body)
--                                            — append a customer message + transition status
--
-- Admin-side reads / writes continue to use admin.support_tickets
-- + admin.support_ticket_messages directly via the admin JWT. The
-- existing admin.create_support_ticket RPC already skips the admin
-- claim check and is customer-callable (ADR-0027 Sprint 3.1, §19).

create or replace function public.list_org_support_tickets()
returns table (
  id              uuid,
  subject         text,
  status          text,
  priority        text,
  category        text,
  reporter_email  text,
  reporter_name   text,
  created_at      timestamptz,
  resolved_at     timestamptz,
  message_count   int
)
language sql
security definer
set search_path = admin, public
as $$
  select
    t.id,
    t.subject,
    t.status,
    t.priority,
    t.category,
    t.reporter_email,
    t.reporter_name,
    t.created_at,
    t.resolved_at,
    (select count(*)::int from admin.support_ticket_messages m where m.ticket_id = t.id)
  from admin.support_tickets t
  where t.org_id = public.current_org_id()
  order by t.created_at desc;
$$;

grant execute on function public.list_org_support_tickets() to authenticated;

create or replace function public.list_support_ticket_messages(p_ticket_id uuid)
returns table (
  id           uuid,
  ticket_id    uuid,
  author_kind  text,
  author_id    uuid,
  body         text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = admin, public
as $$
declare
  v_ticket_org uuid;
  v_caller_org uuid := public.current_org_id();
begin
  select t.org_id into v_ticket_org
    from admin.support_tickets t
   where t.id = p_ticket_id;

  if v_ticket_org is null then
    raise exception 'ticket not found';
  end if;

  if v_caller_org is null or v_caller_org <> v_ticket_org then
    raise exception 'forbidden: ticket does not belong to the caller''s org';
  end if;

  return query
    select m.id, m.ticket_id, m.author_kind, m.author_id, m.body, m.created_at
      from admin.support_ticket_messages m
     where m.ticket_id = p_ticket_id
     order by m.created_at;
end;
$$;

grant execute on function public.list_support_ticket_messages(uuid) to authenticated;

create or replace function public.add_customer_support_message(
  p_ticket_id uuid,
  p_body      text
)
returns uuid
language plpgsql
security definer
set search_path = admin, public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_caller_org uuid := public.current_org_id();
  v_ticket_org uuid;
  v_msg_id     uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'body required';
  end if;

  select t.org_id into v_ticket_org
    from admin.support_tickets t
   where t.id = p_ticket_id;

  if v_ticket_org is null then
    raise exception 'ticket not found';
  end if;

  if v_caller_org is null or v_caller_org <> v_ticket_org then
    raise exception 'forbidden: ticket does not belong to the caller''s org';
  end if;

  insert into admin.support_ticket_messages
    (ticket_id, author_kind, author_id, body)
  values
    (p_ticket_id, 'customer', v_user_id, p_body)
  returning id into v_msg_id;

  -- Status transition hint: customer reply nudges ticket back to
  -- awaiting_operator so the operator queue surfaces it.
  update admin.support_tickets
     set status = 'awaiting_operator'
   where id = p_ticket_id
     and status in ('awaiting_customer', 'resolved', 'closed');

  return v_msg_id;
end;
$$;

grant execute on function public.add_customer_support_message(uuid, text) to authenticated;

-- Verification:
--   select count(*) from pg_proc
--     where proname in ('list_org_support_tickets','list_support_ticket_messages','add_customer_support_message')
--       and pronamespace = 'public'::regnamespace; → 3
