import { createServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function ArtefactDetailPage({
  params,
}: {
  params: Promise<{ artefactId: string }>
}) {
  const { artefactId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: artefact } = await supabase
    .from('consent_artefacts')
    .select(
      'id, artefact_id, consent_event_id, purpose_code, purpose_definition_id, framework, status, data_scope, expires_at, created_at, replaced_by, property_id, banner_id, banner_version, session_fingerprint',
    )
    .eq('artefact_id', artefactId)
    .single()

  if (!artefact) notFound()

  const [eventRes, revocationsRes, receiptsRes, purposeRes, propertyRes] = await Promise.all([
    supabase
      .from('consent_events')
      .select('id, event_type, purposes_accepted, purposes_rejected, created_at, session_fingerprint')
      .eq('id', artefact.consent_event_id)
      .maybeSingle(),
    supabase
      .from('artefact_revocations')
      .select('id, reason, revoked_by_type, revoked_by_ref, revoked_at, dispatched_at, notes')
      .eq('artefact_id', artefact.artefact_id)
      .order('revoked_at', { ascending: true }),
    supabase
      .from('deletion_receipts')
      .select('id, target_system, status, trigger_type, created_at, confirmed_at, failure_reason, request_payload')
      .eq('artefact_id', artefact.artefact_id)
      .order('created_at', { ascending: true }),
    supabase
      .from('purpose_definitions')
      .select('purpose_code, display_name, description, auto_delete_on_expiry')
      .eq('id', artefact.purpose_definition_id)
      .maybeSingle(),
    supabase
      .from('web_properties')
      .select('id, name, url')
      .eq('id', artefact.property_id)
      .maybeSingle(),
  ])

  const event = eventRes.data
  const revocations = revocationsRes.data ?? []
  const receipts = receiptsRes.data ?? []
  const purpose = purposeRes.data
  const property = propertyRes.data

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <div>
        <Link
          href="/dashboard/artefacts"
          className="text-xs text-gray-600 hover:text-black"
        >
          ← Back to Consent Artefacts
        </Link>
        <h1 className="mt-2 text-2xl font-bold font-mono break-all">{artefact.artefact_id}</h1>
        <p className="text-sm text-gray-600">
          {purpose?.display_name ?? artefact.purpose_code} · {artefact.framework.toUpperCase()} ·{' '}
          <StatusPill status={artefact.status} />
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoBlock title="Artefact">
          <Row label="Status" value={<StatusPill status={artefact.status} />} />
          <Row label="Purpose code" value={<code className="font-mono text-xs">{artefact.purpose_code}</code>} />
          <Row label="Framework" value={artefact.framework.toUpperCase()} />
          <Row
            label="Data scope"
            value={
              <div className="flex flex-wrap gap-1">
                {(artefact.data_scope ?? []).map((d: string) => (
                  <span
                    key={d}
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs"
                  >
                    {d}
                  </span>
                ))}
              </div>
            }
          />
          <Row
            label="Expires"
            value={
              artefact.expires_at ? new Date(artefact.expires_at).toLocaleString() : '∞'
            }
          />
          <Row
            label="Created"
            value={new Date(artefact.created_at).toLocaleString()}
          />
          {artefact.replaced_by ? (
            <Row
              label="Replaced by"
              value={
                <Link
                  href={`/dashboard/artefacts/${artefact.replaced_by}`}
                  className="font-mono text-xs text-blue-700 hover:underline"
                >
                  {artefact.replaced_by}
                </Link>
              }
            />
          ) : null}
        </InfoBlock>

        <InfoBlock title="Context">
          <Row label="Property" value={property ? `${property.name} (${property.url})` : '—'} />
          <Row label="Banner" value={`v${artefact.banner_version}`} />
          <Row
            label="Session fingerprint"
            value={
              <code className="break-all font-mono text-xs">
                {artefact.session_fingerprint}
              </code>
            }
          />
          {purpose?.description ? (
            <Row label="Purpose description" value={purpose.description} />
          ) : null}
          <Row
            label="Auto-delete on expiry"
            value={purpose?.auto_delete_on_expiry ? 'yes' : 'no'}
          />
        </InfoBlock>
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Chain of custody</h2>
        <ol className="space-y-3 text-sm">
          <ChainLink
            tone="blue"
            label="1 · Consent event"
            body={
              event ? (
                <>
                  <code className="font-mono text-xs">{event.id}</code> ·{' '}
                  <span className="text-gray-600">{event.event_type}</span> at{' '}
                  {new Date(event.created_at).toLocaleString()}
                  <div className="mt-1 text-xs text-gray-600">
                    Accepted: {(event.purposes_accepted ?? []).join(', ') || '—'} · Rejected:{' '}
                    {(event.purposes_rejected ?? []).join(', ') || '—'}
                  </div>
                </>
              ) : (
                <span className="text-gray-500">Event row not found (may have been deleted).</span>
              )
            }
          />
          <ChainLink
            tone="green"
            label="2 · Consent artefact"
            body={
              <>
                Status <StatusPill status={artefact.status} /> · expires{' '}
                {artefact.expires_at
                  ? new Date(artefact.expires_at).toLocaleDateString()
                  : '∞'}
              </>
            }
          />
          <ChainLink
            tone="amber"
            label={`3 · Revocations (${revocations.length})`}
            body={
              revocations.length === 0 ? (
                <span className="text-gray-500">None.</span>
              ) : (
                <ul className="space-y-1">
                  {revocations.map((r) => (
                    <li key={r.id} className="text-xs">
                      <span className="font-mono">{r.id.slice(0, 8)}</span> · {r.reason} · by{' '}
                      {r.revoked_by_type} at{' '}
                      {new Date(r.revoked_at).toLocaleString()} ·{' '}
                      {r.dispatched_at ? (
                        <span className="text-green-700">dispatched</span>
                      ) : (
                        <span className="text-amber-700">pending dispatch</span>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }
          />
          <ChainLink
            tone="red"
            label={`4 · Deletion receipts (${receipts.length})`}
            body={
              receipts.length === 0 ? (
                <span className="text-gray-500">None.</span>
              ) : (
                <ul className="space-y-1">
                  {receipts.map((r) => (
                    <li key={r.id} className="text-xs">
                      {r.target_system} · {r.trigger_type} ·{' '}
                      <span
                        className={
                          r.status === 'confirmed' || r.status === 'completed'
                            ? 'text-green-700'
                            : r.status === 'failed'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }
                      >
                        {r.status}
                      </span>
                      {r.failure_reason ? (
                        <span className="ml-2 text-red-700">— {r.failure_reason}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </ol>
      </section>
    </main>
  )
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-2">
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ChainLink({
  tone,
  label,
  body,
}: {
  tone: 'blue' | 'green' | 'amber' | 'red'
  label: string
  body: React.ReactNode
}) {
  const border =
    tone === 'blue'
      ? 'border-blue-300'
      : tone === 'green'
        ? 'border-green-300'
        : tone === 'amber'
          ? 'border-amber-300'
          : 'border-red-300'
  return (
    <li className={`border-l-2 ${border} pl-3`}>
      <p className="text-xs font-medium uppercase text-gray-600">{label}</p>
      <div className="mt-1">{body}</div>
    </li>
  )
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'active'
      ? 'bg-green-50 text-green-700'
      : status === 'revoked'
        ? 'bg-red-50 text-red-700'
        : status === 'expired'
          ? 'bg-gray-100 text-gray-700'
          : 'bg-amber-50 text-amber-700'
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${classes}`}>{status}</span>
  )
}
