import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-xs uppercase tracking-widest text-gray-500">
        Digital Personal Data Protection Act · 2023
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">ConsentShield</h1>
      <p className="mt-4 max-w-xl text-lg text-gray-600">
        India&rsquo;s compliance enforcement engine. One snippet on your site records
        every consent event, watches for trackers that shouldn&rsquo;t fire, and gives your
        data principals a verified rights portal.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50"
        >
          Sign in
        </Link>
      </div>

      <section className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold">What your customers see</h2>
          <p className="mt-2 text-sm text-gray-600">
            Five demo sites show the banner, privacy notice, and rights portal in action.
          </p>
          <a
            href="https://consentshield-demo.vercel.app"
            className="mt-3 inline-block text-sm font-medium underline"
          >
            consentshield-demo.vercel.app →
          </a>
        </div>
        <div className="rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold">What your compliance team sees</h2>
          <p className="mt-2 text-sm text-gray-600">
            Dashboard with compliance score, tracker violations, rights request inbox, and
            deletion receipts.
          </p>
          <Link href="/login" className="mt-3 inline-block text-sm font-medium underline">
            Sign in to the dashboard →
          </Link>
        </div>
      </section>

      <footer className="mt-16 border-t border-gray-200 pt-6 text-xs text-gray-500">
        <p>© 2026 Sudhindra Anegondhi</p>
      </footer>
    </main>
  )
}
