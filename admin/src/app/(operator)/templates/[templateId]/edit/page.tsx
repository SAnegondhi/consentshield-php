import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { TemplateForm } from '@/components/templates/template-form'
import type { PurposeRow } from '@/app/(operator)/templates/actions'

// ADR-0030 Sprint 2.1 — Draft editor (drafts only).
//
// If the template isn't a draft, redirect to the detail page so the
// operator isn't caught in an editor that can't save.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ templateId: string }>
}

export default async function EditTemplatePage({ params }: PageProps) {
  const { templateId } = await params
  const supabase = await createServerClient()

  const { data } = await supabase
    .schema('admin')
    .from('sectoral_templates')
    .select(
      'id, template_code, display_name, description, sector, status, purpose_definitions, version',
    )
    .eq('id', templateId)
    .maybeSingle()

  if (!data) notFound()

  if (data.status !== 'draft') {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <p className="text-xs text-text-3">
          <Link href={`/templates/${templateId}`} className="hover:underline">
            ← {data.template_code} v{data.version}
          </Link>
        </p>
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This template is not in draft status ({data.status}) and cannot be
          edited. Use <strong>Clone as new version</strong> from the detail
          page to create a new draft.
        </p>
      </div>
    )
  }

  const allTemplates = await supabase
    .schema('admin')
    .from('sectoral_templates')
    .select('sector')
  const knownSectors = Array.from(
    new Set((allTemplates.data ?? []).map((t) => t.sector as string)),
  ).sort()

  const rawPurposes = Array.isArray(data.purpose_definitions)
    ? (data.purpose_definitions as PurposeRow[])
    : []
  const purposes: PurposeRow[] = rawPurposes.map((p) => ({
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
  }))

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href={`/templates/${templateId}`} className="hover:underline">
            ← {data.template_code} v{data.version}
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          Edit draft: {data.display_name}{' '}
          <span className="text-sm font-normal text-text-3">
            v{data.version}
          </span>
        </h1>
      </header>

      <TemplateForm
        mode="edit"
        templateId={templateId}
        initialValues={{
          templateCode: data.template_code,
          displayName: data.display_name,
          description: data.description,
          sector: data.sector,
          purposes,
        }}
        knownSectors={knownSectors}
      />
    </div>
  )
}
