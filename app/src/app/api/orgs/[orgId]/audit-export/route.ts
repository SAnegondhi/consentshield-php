import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0017 Phase 1: authenticated users in an org can download an
// audit-export ZIP. Aggregation happens server-side via the
// rpc_audit_export_manifest RPC; serialisation + zipping happens here;
// ConsentShield records a manifest row (pointer only — never the bytes).

interface ManifestShape {
  format_version: number
  org_id: string
  generated_at: string
  org: unknown
  data_inventory: unknown[]
  banners: unknown[]
  properties: unknown[]
  consent_events_summary: unknown[]
  rights_requests: unknown[]
  deletion_receipts: unknown[]
  security_scans_rollup: unknown[]
  probe_runs: unknown[]
  section_counts: Record<string, number>
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: manifest, error } = await supabase.rpc('rpc_audit_export_manifest', {
    p_org_id: orgId,
  })
  if (error) {
    const msg = error.message ?? 'export failed'
    const status = msg.includes('not a member') ? 403 : 500
    return NextResponse.json({ error: msg }, { status })
  }

  const m = manifest as ManifestShape

  const zip = new JSZip()
  zip.file('org.json', JSON.stringify(m.org, null, 2))
  zip.file('data_inventory.json', JSON.stringify(m.data_inventory, null, 2))
  zip.file('banners.json', JSON.stringify(m.banners, null, 2))
  zip.file('properties.json', JSON.stringify(m.properties, null, 2))
  zip.file('consent_events_summary.json', JSON.stringify(m.consent_events_summary, null, 2))
  zip.file('rights_requests.json', JSON.stringify(m.rights_requests, null, 2))
  zip.file('deletion_receipts.json', JSON.stringify(m.deletion_receipts, null, 2))
  zip.file('security_scans_rollup.json', JSON.stringify(m.security_scans_rollup, null, 2))
  zip.file('probe_runs.json', JSON.stringify(m.probe_runs, null, 2))

  // ADR-0037 W8 — DEPA section. RLS-gated reads (member-of-org).
  const [purposesRes, mappingsRes, connectorsRes, artefactsRes, metricsRes] = await Promise.all([
    supabase
      .from('purpose_definitions')
      .select(
        'purpose_code, display_name, description, data_scope, default_expiry_days, auto_delete_on_expiry, framework, is_active, created_at',
      )
      .eq('org_id', orgId)
      .order('purpose_code'),
    supabase
      .from('purpose_connector_mappings')
      .select('purpose_definition_id, connector_id, data_categories, created_at')
      .eq('org_id', orgId),
    supabase
      .from('integration_connectors')
      .select('id, connector_type, display_name, status')
      .eq('org_id', orgId),
    supabase
      .from('consent_artefacts')
      .select('purpose_code, framework, status')
      .eq('org_id', orgId),
    supabase
      .from('depa_compliance_metrics')
      .select('total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at')
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  zip.file(
    'depa/purpose_definitions.json',
    JSON.stringify(purposesRes.data ?? [], null, 2),
  )

  // Resolve connector id → display_name for richer mappings output.
  const connectorNameById = new Map(
    (connectorsRes.data ?? []).map((c) => [c.id as string, c.display_name as string]),
  )
  const mappingsOut = (mappingsRes.data ?? []).map((mm) => ({
    purpose_definition_id: mm.purpose_definition_id,
    connector_id: mm.connector_id,
    connector_display_name: connectorNameById.get(mm.connector_id as string) ?? null,
    data_categories: mm.data_categories,
    created_at: mm.created_at,
  }))
  zip.file('depa/purpose_connector_mappings.json', JSON.stringify(mappingsOut, null, 2))

  // Artefacts summary — counts by (status, framework, purpose_code). No PII.
  const summary = new Map<string, { status: string; framework: string; purpose_code: string; count: number }>()
  for (const a of artefactsRes.data ?? []) {
    const key = `${a.status}|${a.framework}|${a.purpose_code}`
    const cur = summary.get(key)
    if (cur) cur.count++
    else
      summary.set(key, {
        status: a.status as string,
        framework: a.framework as string,
        purpose_code: a.purpose_code as string,
        count: 1,
      })
  }
  const summaryCsv = [
    'status,framework,purpose_code,count',
    ...Array.from(summary.values()).map(
      (s) => `${s.status},${s.framework},${s.purpose_code},${s.count}`,
    ),
  ].join('\n')
  zip.file('depa/artefacts_summary.csv', summaryCsv + '\n')

  zip.file(
    'depa/compliance_metrics.json',
    JSON.stringify(metricsRes.data ?? null, null, 2),
  )

  // Write manifest.json last so section_counts reflects the DEPA additions.
  const sectionCountsWithDepa = {
    ...m.section_counts,
    'depa/purpose_definitions': purposesRes.data?.length ?? 0,
    'depa/purpose_connector_mappings': mappingsOut.length,
    'depa/artefacts_summary': summary.size,
    'depa/compliance_metrics': metricsRes.data ? 1 : 0,
  }
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format_version: m.format_version,
        org_id: m.org_id,
        generated_at: m.generated_at,
        section_counts: sectionCountsWithDepa,
      },
      null,
      2,
    ),
  )

  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

  // Record a manifest row (pointer only — never the bytes).
  // N-S2: fail loudly. A silent insert failure would ship a ZIP with no
  // audit-trail row, breaking rule #4's customer-owned-record guarantee.
  const { error: manifestError } = await supabase
    .from('audit_export_manifests')
    .insert({
      org_id: orgId,
      requested_by: user.id,
      format_version: m.format_version,
      section_counts: sectionCountsWithDepa,
      content_bytes: archive.byteLength,
      delivery_target: 'direct_download',
    })
  if (manifestError) {
    return NextResponse.json(
      {
        error: 'Failed to record export manifest',
        detail: manifestError.message,
      },
      { status: 500 },
    )
  }

  const filename = `audit-export-${orgId}-${m.generated_at.replace(/[:.]/g, '-')}.zip`
  return new NextResponse(archive as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(archive.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
