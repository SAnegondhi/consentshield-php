-- ADR-0028 Sprint 2.1 — public.admin_cron_snapshot() RPC.
--
-- The Operations Dashboard renders a cron status card listing every
-- scheduled job (admin-*, DEPA, customer). The admin app's JWT (end
-- user, is_admin=true) has no grants on the `cron.*` schema — only
-- the postgres superuser role does by default. Wrap the query in a
-- SECURITY DEFINER function so the admin UI can read it without
-- needing schema grants.
--
-- Returns a jsonb array, one object per job:
--   { jobname, schedule, last_run_at, last_status, last_run_ago_seconds }
--
-- last_status comes from the most recent cron.job_run_details row; null
-- if the job has never run. `last_run_ago_seconds` is computed so the UI
-- can render the "Nm ago" column without extra date-math on the client.

create or replace function public.admin_cron_snapshot()
returns jsonb
language sql
security definer
set search_path = public, cron
as $$
  with last_runs as (
    select distinct on (jobid)
      jobid,
      end_time,
      status
      from cron.job_run_details
     order by jobid, end_time desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobname', j.jobname,
        'schedule', j.schedule,
        'active', j.active,
        'last_run_at', lr.end_time,
        'last_status', lr.status,
        'last_run_ago_seconds',
          case
            when lr.end_time is null then null
            else extract(epoch from (now() - lr.end_time))::int
          end
      )
      order by j.jobname
    ),
    '[]'::jsonb
  )
    from cron.job j
    left join last_runs lr on lr.jobid = j.jobid;
$$;

grant execute on function public.admin_cron_snapshot() to authenticated;

-- Verification:
--   select jsonb_array_length(public.admin_cron_snapshot()); → count(*) from cron.job
