import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExportButton } from './export-button'

interface ManifestRow {
  id: string
  format_version: number
  section_counts: Record<string, number> | null
  content_bytes: number | null
  delivery_target: string | null
  created_at: string
}

export default async function ExportsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const orgId = membership.org_id as string
  const { data: manifests } = await supabase
    .from('audit_export_manifests')
    .select('id, format_version, section_counts, content_bytes, delivery_target, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (manifests ?? []) as ManifestRow[]

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Audit Exports</h1>
        <p className="text-sm text-gray-600">
          Download a ZIP of your compliance snapshot. See ADR-0017 for
          what each file contains. v1 delivers the archive as a direct
          HTTP download; customer-R2 upload lands in a later sprint.
        </p>
      </div>

      <div className="rounded border border-gray-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Generate a new export</p>
          <p className="text-xs text-gray-500">
            Aggregates org profile, data inventory, banners, consent-event
            summaries, rights requests, deletion receipts, security scans,
            and probe runs into one ZIP.
          </p>
        </div>
        <ExportButton orgId={orgId} />
      </div>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">History</h2>
          <p className="text-xs text-gray-500">
            ConsentShield stores pointers to past exports, never the bytes.
          </p>
        </div>
        {rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Sections</th>
                <th className="px-4 py-2 font-medium">Format</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-200">
                  <td className="px-4 py-2 text-xs text-gray-700">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.content_bytes ? `${(r.content_bytes / 1024).toFixed(1)} KB` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {r.delivery_target ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {r.section_counts
                      ? Object.entries(r.section_counts).map(([k, v]) => `${k}: ${v}`).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">v{r.format_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No exports yet. Generate one above.
          </p>
        )}
      </section>
    </main>
  )
}
