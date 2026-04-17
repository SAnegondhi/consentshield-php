import { DashboardNav } from '@/components/dashboard-nav'
import { SuspendedOrgBanner } from '@/components/suspended-banner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <DashboardNav />
      <div className="flex flex-1 flex-col">
        <SuspendedOrgBanner />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  )
}
