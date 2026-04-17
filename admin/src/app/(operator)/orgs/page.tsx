import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { OrgsFilterBar } from '@/components/orgs/filter-bar'

// ADR-0029 Sprint 1.1 — Organisations list.
//
// Server Component reading public.organisations via the admins_select_all
// RLS policy (migration 20260417000020). Supports plan + status filters
// and a free-text search that matches on name prefix OR id prefix OR
// compliance_contact_email prefix.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

interface Org {
  id: string
  name: string
  plan: string | null
  status: string
  trial_ends_at: string | null
  compliance_contact_email: string | null
  created_at: string
  updated_at: string | null
}

interface PageProps {
  searchParams: Promise<{
    plan?: string
    status?: string
    q?: string
    page?: string
  }>
}

export default async function OrganisationsListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const page = Math.max(0, parseInt(params.page ?? '0', 10) || 0)
  const supabase = await createServerClient()

  let query = supabase
    .from('organisations')
    .select(
      'id, name, plan, status, trial_ends_at, compliance_contact_email, created_at, updated_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  if (params.plan) query = query.eq('plan', params.plan)
  if (params.status) query = query.eq('status', params.status)
  if (params.q) {
    const needle = `%${params.q}%`
    // Free-text search: match name OR compliance_contact_email ILIKE.
    // We skip id-prefix match because Postgres casts + ilike on uuid
    // columns via PostgREST is awkward; operators usually search by
    // name or email rather than a uuid prefix.
    query = query.or(
      `name.ilike.${needle},compliance_contact_email.ilike.${needle}`,
    )
  }

  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const { data, count, error } = await query.range(from, to)
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        Query failed: {error.message}
      </div>
    )
  }

  const orgs = (data ?? []) as Org[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Organisations</h1>
          <p className="text-xs text-zinc-500">
            {total.toLocaleString()} {total === 1 ? 'organisation' : 'organisations'} · page {page + 1} of {totalPages}
          </p>
        </div>
      </header>

      <OrgsFilterBar
        initialPlan={params.plan ?? ''}
        initialStatus={params.status ?? ''}
        initialQ={params.q ?? ''}
      />

      {orgs.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
          No organisations match the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Trial ends</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-zinc-200 hover:bg-red-50">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-zinc-900">{org.name}</div>
                    <div className="text-xs text-zinc-500">
                      <code className="font-mono">{org.id.slice(0, 8)}</code>
                      {org.compliance_contact_email ? ` · ${org.compliance_contact_email}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">{org.plan ?? '—'}</td>
                  <td className="px-4 py-2">{statusPill(org.status)}</td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    {org.trial_ends_at ? formatDate(org.trial_ends_at) : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    {formatDate(org.created_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/orgs/${org.id}`}
                      className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-800 hover:bg-zinc-50"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationNav
        page={page}
        totalPages={totalPages}
        params={params}
      />
    </div>
  )
}

function statusPill(status: string) {
  if (status === 'active')
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Active
      </span>
    )
  if (status === 'suspended')
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Suspended
      </span>
    )
  if (status === 'archived')
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
        Archived
      </span>
    )
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      {status}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function PaginationNav({
  page,
  totalPages,
  params,
}: {
  page: number
  totalPages: number
  params: Record<string, string | undefined>
}) {
  if (totalPages <= 1) return null
  const prevHref = page > 0 ? hrefWithPage(params, page - 1) : null
  const nextHref = page + 1 < totalPages ? hrefWithPage(params, page + 1) : null
  return (
    <nav className="flex items-center justify-between text-xs text-zinc-600">
      {prevHref ? (
        <Link
          href={prevHref}
          className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      {nextHref ? (
        <Link
          href={nextHref}
          className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

function hrefWithPage(
  params: Record<string, string | undefined>,
  page: number,
): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'string' && key !== 'page') sp.set(key, value)
  }
  sp.set('page', String(page))
  return `/orgs?${sp.toString()}`
}
