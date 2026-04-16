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
  zip.file('manifest.json', JSON.stringify({
    format_version: m.format_version,
    org_id: m.org_id,
    generated_at: m.generated_at,
    section_counts: m.section_counts,
  }, null, 2))
  zip.file('org.json', JSON.stringify(m.org, null, 2))
  zip.file('data_inventory.json', JSON.stringify(m.data_inventory, null, 2))
  zip.file('banners.json', JSON.stringify(m.banners, null, 2))
  zip.file('properties.json', JSON.stringify(m.properties, null, 2))
  zip.file('consent_events_summary.json', JSON.stringify(m.consent_events_summary, null, 2))
  zip.file('rights_requests.json', JSON.stringify(m.rights_requests, null, 2))
  zip.file('deletion_receipts.json', JSON.stringify(m.deletion_receipts, null, 2))
  zip.file('security_scans_rollup.json', JSON.stringify(m.security_scans_rollup, null, 2))
  zip.file('probe_runs.json', JSON.stringify(m.probe_runs, null, 2))

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
      section_counts: m.section_counts,
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
