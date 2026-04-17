import { createServerClient } from '@/lib/supabase/server'
import { PipelineTabs, type PipelineData } from './pipeline-tabs'

// ADR-0033 Sprint 1.2 — Pipeline Operations panel.
//
// Four tabs powered by the admin.pipeline_* RPCs shipped in Sprint 1.1:
//   · Worker errors (admin.pipeline_worker_errors_list)
//   · Stuck buffers (admin.pipeline_stuck_buffers_snapshot)
//   · DEPA expiry queue (admin.pipeline_depa_expiry_queue)
//   · Delivery health (admin.pipeline_delivery_health)
//
// Initial paint is server-rendered with all 4 RPCs in parallel; the
// client component re-fetches via router.refresh() every 30s.

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createServerClient()

  const [workerErrors, stuckBuffers, expiryQueue, deliveryHealth] =
    await Promise.all([
      supabase.schema('admin').rpc('pipeline_worker_errors_list', {
        p_limit: 100,
      }),
      supabase.schema('admin').rpc('pipeline_stuck_buffers_snapshot'),
      supabase.schema('admin').rpc('pipeline_depa_expiry_queue'),
      supabase.schema('admin').rpc('pipeline_delivery_health', {
        p_window_hours: 24,
      }),
    ])

  const errors = [
    workerErrors.error?.message,
    stuckBuffers.error?.message,
    expiryQueue.error?.message,
    deliveryHealth.error?.message,
  ].filter((e): e is string => !!e)

  const data: PipelineData = {
    workerErrors: (workerErrors.data ?? []) as PipelineData['workerErrors'],
    stuckBuffers: (stuckBuffers.data ?? []) as PipelineData['stuckBuffers'],
    expiryQueue: (expiryQueue.data ?? []) as PipelineData['expiryQueue'],
    deliveryHealth: (deliveryHealth.data ?? []) as PipelineData['deliveryHealth'],
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pipeline Operations</h1>
          <p className="text-sm text-text-2">
            Live view of Worker ingestion, buffer health, DEPA expiry, and
            delivery throughput.
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--border)] bg-bg px-3 py-1 text-[11px] text-text-3">
          Live · auto-refresh 30s
        </span>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      <PipelineTabs data={data} />
    </div>
  )
}
