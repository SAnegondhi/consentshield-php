import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import {
  ConnectorForm,
  type ConnectorFormInput,
} from '@/components/connectors/connector-form'

// ADR-0031 Sprint 1.2 — New connector / Clone-as-new-version.
//
// Accepts ?from=<connectorId> to prefill the form for a version bump.

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ from?: string }>
}

export default async function NewConnectorPage({ searchParams }: PageProps) {
  const { from } = await searchParams

  let initial: Partial<ConnectorFormInput> | undefined

  if (from) {
    const supabase = await createServerClient()
    const { data } = await supabase
      .schema('admin')
      .from('connector_catalogue')
      .select(
        'connector_code, display_name, vendor, version, supported_purpose_codes, required_credentials_schema, webhook_endpoint_template, documentation_url, retention_lock_supported',
      )
      .eq('id', from)
      .maybeSingle()
    if (data) {
      initial = {
        connectorCode: data.connector_code,
        displayName: data.display_name,
        vendor: data.vendor,
        version: '', // force operator to pick a new version
        supportedPurposesCsv: (data.supported_purpose_codes ?? []).join(', '),
        requiredCredentialsJson: JSON.stringify(
          data.required_credentials_schema,
          null,
          2,
        ),
        webhookEndpointTemplate: data.webhook_endpoint_template,
        documentationUrl: data.documentation_url ?? '',
        retentionLockSupported: data.retention_lock_supported,
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/connectors" className="hover:underline">
            ← Connector Catalogue
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {from ? 'Clone connector as new version' : 'New connector'}
        </h1>
        <p className="text-sm text-text-2">
          {from
            ? 'Bump the version string. All other fields are editable.'
            : 'Add a new pre-built deletion connector. Goes live as active immediately.'}
        </p>
      </header>

      <ConnectorForm mode="create" initial={initial} />
    </div>
  )
}
