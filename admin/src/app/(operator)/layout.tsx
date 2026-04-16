import Link from 'next/link'

// Operator shell. Red admin-mode strip + red sidebar border per the
// admin wireframe (docs/admin/design/consentshield-admin-screens.html).
// Nav items are stub links to `#` — routes are added by ADR-0028+.

const NAV_ITEMS: Array<{ label: string; adr: string }> = [
  { label: 'Operations Dashboard', adr: 'ADR-0028' },
  { label: 'Organisations', adr: 'ADR-0029' },
  { label: 'Support Tickets', adr: 'ADR-0032' },
  { label: 'Sectoral Templates', adr: 'ADR-0030' },
  { label: 'Connector Catalogue', adr: 'ADR-0031' },
  { label: 'Tracker Signatures', adr: 'ADR-0031' },
  { label: 'Pipeline Operations', adr: 'ADR-0033' },
  { label: 'Billing Operations', adr: 'ADR-0034' },
  { label: 'Abuse & Security', adr: 'ADR-0035' },
  { label: 'Feature Flags & Kill Switches', adr: 'ADR-0036' },
  { label: 'Audit Log', adr: 'ADR-0028' },
]

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen">
      {/* Admin-mode strip (Rule 25 visual cue) */}
      <div className="bg-red-700 py-1 text-center text-xs font-mono uppercase tracking-wider text-white">
        ConsentShield — Operator Console (Admin Mode)
      </div>

      <div className="flex min-h-[calc(100vh-28px)]">
        <aside className="w-64 border-r-2 border-red-700 bg-white">
          <div className="border-b border-zinc-200 p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-red-700">
              Admin
            </p>
            <p className="mt-1 text-sm font-semibold">ConsentShield</p>
          </div>
          <nav className="p-2">
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.label}>
                  <Link
                    href="#"
                    className="block rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                    title={`Ships in ${item.adr}`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  )
}
