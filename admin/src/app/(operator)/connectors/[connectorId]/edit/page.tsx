import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ConnectorForm } from '@/components/connectors/connector-form'

// ADR-0031 Sprint 1.2 — Connector editor.
//
// Refuses when status ≠ active. Code / vendor / version are read-only
// (versioning invariant — create a new version via Clone instead).

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ connectorId: string }>
}

export default async function EditConnectorPage({ params }: PageProps) {
  const { connectorId } = await params
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .schema('admin')
    .from('connector_catalogue')
    .select(
      'id, connector_code, display_name, vendor, version, status, supported_purpose_codes, required_credentials_schema, webhook_endpoint_template, documentation_url, retention_lock_supported',
    )
    .eq('id', connectorId)
    .maybeSingle()

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Edit connector</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }
  if (!data) notFound()

  if (data.status !== 'active') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <p className="text-xs text-text-3">
            <Link href={`/connectors/${connectorId}`} className="hover:underline">
              ← Connector detail
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold">Edit connector</h1>
        </header>
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Only <strong>active</strong> connectors can be edited. This one is{' '}
          <strong>{data.status}</strong>. Use <em>Clone as new version</em>{' '}
          from the detail page to ship an updated version.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href={`/connectors/${connectorId}`} className="hover:underline">
            ← {data.display_name} {data.version}
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">Edit connector</h1>
      </header>
      <ConnectorForm
        mode="edit"
        connectorId={connectorId}
        initial={{
          connectorCode: data.connector_code,
          displayName: data.display_name,
          vendor: data.vendor,
          version: data.version,
          supportedPurposesCsv: (data.supported_purpose_codes ?? []).join(', '),
          requiredCredentialsJson: JSON.stringify(
            data.required_credentials_schema,
            null,
            2,
          ),
          webhookEndpointTemplate: data.webhook_endpoint_template,
          documentationUrl: data.documentation_url ?? '',
          retentionLockSupported: data.retention_lock_supported,
        }}
      />
    </div>
  )
}
