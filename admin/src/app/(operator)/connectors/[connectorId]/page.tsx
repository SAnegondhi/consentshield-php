import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ConnectorDetailActions } from '@/components/connectors/detail-actions'

// ADR-0031 Sprint 1.1 — Connector detail page.

export const dynamic = 'force-dynamic'

interface Connector {
  id: string
  connector_code: string
  display_name: string
  vendor: string
  version: string
  status: 'active' | 'deprecated' | 'retired'
  supported_purpose_codes: string[]
  required_credentials_schema: Record<string, unknown>
  webhook_endpoint_template: string
  documentation_url: string | null
  retention_lock_supported: boolean
  created_at: string
  created_by: string
  deprecated_at: string | null
  deprecated_replacement_id: string | null
  cutover_deadline: string | null
}

interface PageProps {
  params: Promise<{ connectorId: string }>
}

export default async function ConnectorDetailPage({ params }: PageProps) {
  const { connectorId } = await params
  const supabase = await createServerClient()

  const { data: row, error } = await supabase
    .schema('admin')
    .from('connector_catalogue')
    .select(
      'id, connector_code, display_name, vendor, version, status, supported_purpose_codes, required_credentials_schema, webhook_endpoint_template, documentation_url, retention_lock_supported, created_at, created_by, deprecated_at, deprecated_replacement_id, cutover_deadline',
    )
    .eq('id', connectorId)
    .maybeSingle()

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold">Connector</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  if (!row) notFound()

  const connector = row as Connector

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const adminRole =
    (user?.app_metadata?.admin_role as
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'
  const canWrite = adminRole === 'platform_operator'

  const { data: creator } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', connector.created_by)
    .maybeSingle()

  const { data: replacement } = connector.deprecated_replacement_id
    ? await supabase
        .schema('admin')
        .from('connector_catalogue')
        .select('id, connector_code, version')
        .eq('id', connector.deprecated_replacement_id)
        .maybeSingle()
    : { data: null }

  // For the Deprecate modal we need the list of candidate active connectors.
  const { data: activeCandidates } = await supabase
    .schema('admin')
    .from('connector_catalogue')
    .select('id, connector_code, version')
    .eq('status', 'active')
    .neq('id', connector.id)
    .order('connector_code')

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-3">
            <Link href="/connectors" className="hover:underline">
              ← Connector Catalogue
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold">
            {connector.display_name}{' '}
            <span className="text-sm font-normal text-text-3">
              {connector.version}
            </span>
          </h1>
          <p className="mt-1 font-mono text-xs text-text-3">
            {connector.connector_code} · {connector.vendor}
          </p>
        </div>
        <StatusPill status={connector.status} />
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoTile label="Created">
          {new Date(connector.created_at).toLocaleDateString()}
          <br />
          <span className="text-xs text-text-3">
            {creator?.display_name ?? connector.created_by.slice(0, 8)}
          </span>
        </InfoTile>
        <InfoTile label="Retention lock">
          {connector.retention_lock_supported ? 'Supported' : 'Not supported'}
        </InfoTile>
        <InfoTile label="Deprecated">
          {connector.deprecated_at ? (
            <>
              {new Date(connector.deprecated_at).toLocaleDateString()}
              {replacement ? (
                <>
                  <br />
                  <Link
                    href={`/connectors/${replacement.id}`}
                    className="text-xs text-red-700 hover:underline"
                  >
                    → {replacement.connector_code} {replacement.version}
                  </Link>
                </>
              ) : null}
              {connector.cutover_deadline ? (
                <>
                  <br />
                  <span className="text-xs text-text-3">
                    cutover:{' '}
                    {new Date(connector.cutover_deadline).toLocaleDateString()}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-text-3">—</span>
          )}
        </InfoTile>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Supported purposes</h2>
        <div className="mt-2 flex flex-wrap gap-1">
          {(connector.supported_purpose_codes ?? []).length === 0 ? (
            <span className="text-xs text-text-3">—</span>
          ) : (
            connector.supported_purpose_codes.map((p) => (
              <span
                key={p}
                className="rounded bg-bg px-2 py-0.5 font-mono text-xs text-text-2"
              >
                {p}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Webhook endpoint template</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-3 font-mono text-xs text-text">
          {connector.webhook_endpoint_template}
        </pre>
        {connector.documentation_url ? (
          <p className="mt-2 text-xs text-text-3">
            Documentation:{' '}
            <a
              href={connector.documentation_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-red-700 hover:underline"
            >
              {connector.documentation_url}
            </a>
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Required credentials (JSON schema)</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-3 font-mono text-xs text-text">
          {JSON.stringify(connector.required_credentials_schema, null, 2)}
        </pre>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <ConnectorDetailActions
          connectorId={connector.id}
          status={connector.status}
          canWrite={canWrite}
          activeCandidates={(activeCandidates ?? []).map((c) => ({
            id: c.id,
            label: `${c.connector_code} ${c.version}`,
          }))}
        />
      </section>
    </div>
  )
}

function StatusPill({
  status,
}: {
  status: 'active' | 'deprecated' | 'retired'
}) {
  const classes =
    status === 'active'
      ? 'rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700'
      : status === 'deprecated'
        ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800'
        : 'rounded-full bg-[color:var(--border)] px-3 py-1 text-xs font-medium text-text-2'
  return <span className={classes}>{status}</span>
}

function InfoTile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className="mt-1 text-sm text-text">{children}</p>
    </div>
  )
}
