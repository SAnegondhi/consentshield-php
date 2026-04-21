export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">
              ConsentShield
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-gray-600">
              Onboarding
            </span>
          </div>
          <a
            href="mailto:hello@consentshield.in"
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Need help?
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  )
}
