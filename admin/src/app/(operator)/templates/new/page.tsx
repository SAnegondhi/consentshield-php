import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { TemplateForm } from '@/components/templates/template-form'
import type {
  PurposeRow,
  StorageMode,
  ConnectorDefaults,
} from '@/app/(operator)/templates/actions'

// ADR-0030 Sprint 2.1 — New-draft form.
//
// Accepts ?from=<templateId> to prefill from an existing template
// (Clone as new version). The prefill copies template_code, sector,
// display_name, description, and purposes. Template code + sector
// are editable since a real "new version" of the same code is one
// click (submit keeps the code; the RPC auto-increments version).

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ from?: string }>
}

const EMPTY_INITIAL = {
  templateCode: '',
  displayName: '',
  description: '',
  sector: 'general',
  purposes: [] as PurposeRow[],
  defaultStorageMode: null as StorageMode | null,
  connectorDefaultsJson: '',
}

export default async function NewTemplatePage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  const { data: allTemplates } = await supabase
    .schema('admin')
    .from('sectoral_templates')
    .select('sector')

  const knownSectors = Array.from(
    new Set((allTemplates ?? []).map((t) => t.sector as string)),
  ).sort()

  let initial = EMPTY_INITIAL
  if (params.from) {
    const { data: source } = await supabase
      .schema('admin')
      .from('sectoral_templates')
      .select(
        'template_code, display_name, description, sector, purpose_definitions, default_storage_mode, connector_defaults',
      )
      .eq('id', params.from)
      .maybeSingle()

    if (source) {
      const purposes = Array.isArray(source.purpose_definitions)
        ? (source.purpose_definitions as PurposeRow[])
        : []
      const cd = source.connector_defaults as ConnectorDefaults | null
      initial = {
        templateCode: source.template_code,
        displayName: source.display_name,
        description: source.description,
        sector: source.sector,
        purposes: purposes.map((p) => ({
          purpose_code: p.purpose_code ?? '',
          display_name: p.display_name ?? '',
          framework: p.framework ?? 'DPDP',
          data_scope: Array.isArray(p.data_scope)
            ? p.data_scope
            : typeof p.data_scope === 'string' && p.data_scope
              ? [p.data_scope]
              : [],
          default_expiry:
            typeof p.default_expiry === 'string'
              ? p.default_expiry
              : p.default_expiry != null
                ? String(p.default_expiry)
                : '',
          auto_delete: p.auto_delete === true,
        })),
        defaultStorageMode: (source.default_storage_mode as StorageMode | null) ?? null,
        connectorDefaultsJson: cd ? JSON.stringify(cd, null, 2) : '',
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/templates" className="hover:underline">
            ← Sectoral Templates
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {params.from ? 'Clone as new version' : 'New sectoral template (draft)'}
        </h1>
        <p className="mt-1 text-sm text-text-2">
          {params.from
            ? 'Submitting creates a new draft with the same template_code — the version number auto-increments.'
            : 'Creates a draft with version 1. Publish later via the detail page.'}
        </p>
      </header>

      <TemplateForm mode="new" initialValues={initial} knownSectors={knownSectors} />
    </div>
  )
}
