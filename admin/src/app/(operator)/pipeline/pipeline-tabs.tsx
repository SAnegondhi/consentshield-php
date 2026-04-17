'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ADR-0033 Sprint 1.2 — Pipeline tabs (client).

export interface PipelineData {
  workerErrors: Array<{
    id: string
    occurred_at: string
    endpoint: string
    status_code: number | null
    upstream_error: string | null
    org_id: string
    org_name: string
    property_id: string | null
  }>
  stuckBuffers: Array<{
    buffer_table: string
    stuck_count: number
    oldest_created: string | null
    oldest_age_seconds: number | null
  }>
  expiryQueue: Array<{
    org_id: string
    org_name: string
    expiring_lt_7d: number
    expiring_lt_30d: number
    expired_awaiting_enforce: number
    last_expiry_alert_at: string | null
  }>
  deliveryHealth: Array<{
    org_id: string
    org_name: string
    median_latency_ms: number | null
    p95_latency_ms: number | null
    failure_count: number
    throughput: number
    success_rate: number | null
  }>
}

type TabKey = 'worker' | 'buffers' | 'expiry' | 'delivery'

export function PipelineTabs({ data }: { data: PipelineData }) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('worker')

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'worker', label: 'Worker errors', count: data.workerErrors.length },
    {
      key: 'buffers',
      label: 'Stuck buffers',
      count: data.stuckBuffers.filter((b) => b.stuck_count > 0).length,
    },
    {
      key: 'expiry',
      label: 'DEPA expiry queue',
      count: data.expiryQueue.length,
    },
    {
      key: 'delivery',
      label: 'Delivery health',
      count: data.deliveryHealth.length,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex gap-0 rounded-md border border-[color:var(--border)] bg-white p-1 shadow-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              t.key === tab
                ? 'rounded bg-teal px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded px-3 py-1.5 text-xs text-text-2 hover:bg-bg'
            }
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span
                className={
                  t.key === tab
                    ? 'ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px]'
                    : 'ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-3'
                }
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'worker' ? <WorkerErrorsTab rows={data.workerErrors} /> : null}
      {tab === 'buffers' ? <StuckBuffersTab rows={data.stuckBuffers} /> : null}
      {tab === 'expiry' ? <ExpiryQueueTab rows={data.expiryQueue} /> : null}
      {tab === 'delivery' ? <DeliveryHealthTab rows={data.deliveryHealth} /> : null}
    </div>
  )
}

function Card({
  title,
  pill,
  children,
}: {
  title: string
  pill?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {pill}
      </header>
      {children}
    </section>
  )
}

function WorkerErrorsTab({ rows }: { rows: PipelineData['workerErrors'] }) {
  const pill =
    rows.length === 0 ? (
      <Pill tone="green">healthy</Pill>
    ) : rows.length < 10 ? (
      <Pill tone="amber">{rows.length} events</Pill>
    ) : (
      <Pill tone="red">{rows.length} events</Pill>
    )
  return (
    <Card title="worker_errors — last 24h" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No Worker write failures in the last 24 hours. Either the pipeline is
          healthy or the Worker hasn&apos;t been exercised — check{' '}
          <span className="font-mono">/pipeline/delivery-health</span> for
          throughput.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Upstream error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.occurred_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{r.endpoint}</td>
                  <td className="px-4 py-2 text-xs">{r.org_name}</td>
                  <td className="px-4 py-2 text-xs">{r.status_code ?? '—'}</td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    {r.upstream_error?.slice(0, 120) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function StuckBuffersTab({ rows }: { rows: PipelineData['stuckBuffers'] }) {
  const stuckTotal = rows.reduce((acc, r) => acc + (r.stuck_count ?? 0), 0)
  const pill =
    stuckTotal === 0 ? (
      <Pill tone="green">0 stuck (target: 0)</Pill>
    ) : (
      <Pill tone="red">{stuckTotal} stuck rows</Pill>
    )
  return (
    <Card title="Stuck buffer rows by table" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No buffer rows older than 1 hour.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Stuck count (&gt;1h)</th>
                <th className="px-4 py-2">Oldest age</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.buffer_table}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.buffer_table}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.stuck_count}</td>
                  <td className="px-4 py-2 text-xs">
                    {formatAge(r.oldest_age_seconds)}
                  </td>
                  <td className="px-4 py-2">
                    <BufferStatus
                      count={r.stuck_count}
                      age={r.oldest_age_seconds}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Any row &gt; 1 hour is a pipeline failure; any row &gt; 24 hours is a P0.
        Amber fires at 30 minutes.
      </footer>
    </Card>
  )
}

function ExpiryQueueTab({ rows }: { rows: PipelineData['expiryQueue'] }) {
  const expiredTotal = rows.reduce(
    (a, r) => a + (r.expired_awaiting_enforce ?? 0),
    0,
  )
  const pill =
    expiredTotal === 0 ? (
      <Pill tone="green">cron healthy</Pill>
    ) : (
      <Pill tone="amber">{expiredTotal} expired rows</Pill>
    )
  return (
    <Card title="DEPA artefact expiry pipeline" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No orgs with artefacts expiring in the next 30 days.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">&lt; 7 days</th>
                <th className="px-4 py-2">&lt; 30 days</th>
                <th className="px-4 py-2">Expired awaiting enforce</th>
                <th className="px-4 py-2">Last expiry alert</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.org_id}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2">
                    <strong>{r.org_name}</strong>
                    <span className="ml-2 font-mono text-[11px] text-text-3">
                      {r.org_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.expiring_lt_7d}</td>
                  <td className="px-4 py-2 text-xs">{r.expiring_lt_30d}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.expired_awaiting_enforce}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-3">
                    {r.last_expiry_alert_at
                      ? relative(r.last_expiry_alert_at)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function DeliveryHealthTab({
  rows,
}: {
  rows: PipelineData['deliveryHealth']
}) {
  const totalThroughput = rows.reduce((a, r) => a + (r.throughput ?? 0), 0)
  const totalFailures = rows.reduce((a, r) => a + (r.failure_count ?? 0), 0)
  return (
    <Card
      title="Delivery health (last 24h)"
      pill={
        totalFailures === 0 ? (
          <Pill tone="green">healthy</Pill>
        ) : (
          <Pill tone="amber">{totalFailures} failures</Pill>
        )
      }
    >
      <div className="grid grid-cols-3 gap-3 p-4">
        <MetricTile
          label="Total throughput"
          value={totalThroughput.toLocaleString()}
          delta="consent events delivered"
        />
        <MetricTile
          label="Total failures"
          value={totalFailures.toLocaleString()}
        />
        <MetricTile label="Orgs with activity" value={rows.length.toString()} />
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No delivery activity in the last 24 hours.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Median latency</th>
                <th className="px-4 py-2">P95 latency</th>
                <th className="px-4 py-2">Failures (24h)</th>
                <th className="px-4 py-2">Throughput (24h)</th>
                <th className="px-4 py-2">Success</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.org_id}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2">
                    <strong>{r.org_name}</strong>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.median_latency_ms != null
                      ? `${r.median_latency_ms} ms`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.p95_latency_ms != null ? `${r.p95_latency_ms} ms` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.failure_count}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.throughput.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.success_rate != null ? `${r.success_rate}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Latency is read from <code>audit_log.payload.latency_ms</code> when
        present. Upstream writers populate it best-effort.
      </footer>
    </Card>
  )
}

function MetricTile({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta?: string
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-text">{value}</p>
      {delta ? <p className="text-[11px] text-text-3">{delta}</p> : null}
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red'
  children: React.ReactNode
}) {
  const classes =
    tone === 'green'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700'
      : tone === 'amber'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'
        : 'rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700'
  return <span className={classes}>{children}</span>
}

function BufferStatus({
  count,
  age,
}: {
  count: number
  age: number | null
}) {
  if (count === 0) return <Pill tone="green">OK</Pill>
  const ageSec = age ?? 0
  if (ageSec > 86_400) return <Pill tone="red">P0 (&gt;24h)</Pill>
  if (ageSec > 3600) return <Pill tone="red">failure (&gt;1h)</Pill>
  if (ageSec > 1800) return <Pill tone="amber">warn (&gt;30m)</Pill>
  return <Pill tone="green">OK</Pill>
}

function formatAge(seconds: number | null) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(iso).toLocaleString()
}
