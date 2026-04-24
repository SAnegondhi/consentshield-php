import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About this site',
  description:
    'What testing.consentshield.in is, why it exists, and how to trust what it publishes.'
}

export default function AboutPage() {
  return (
    <article className="prose prose-slate max-w-none">
      <h1 className="text-3xl font-bold tracking-tight text-navy">About this site</h1>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink">What this is</h2>
        <p className="mt-3 text-slate-700">
          <code className="text-slate-900 bg-slate-100 rounded px-1 py-0.5">testing.consentshield.in</code>{' '}
          is the public index of ConsentShield end-to-end test runs. It exists so that a
          prospective partner, auditor, or enterprise reviewer can see — without access to our
          internal CI — which runs have passed, which have failed, and where the sealed
          evidence lives.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink">Why it's hosted separately</h2>
        <p className="mt-3 text-slate-700">
          This site lives on a dedicated Vercel project, isolated from the marketing site, the
          customer app, and the admin console. An outage in any of those does not hide the
          evidence archive; an outage here doesn't affect production integrations. That
          separation is load-bearing for the auditor-facing contract and is captured in{' '}
          <a
            className="underline hover:text-ink"
            href="https://github.com/aiSpirit-systems/consentshield/blob/main/docs/ADRs/ADR-1014-e2e-test-harness-and-vertical-demos.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            ADR-1014
          </a>{' '}
          Sprint 5.3.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink">How to trust a published run</h2>
        <ol className="mt-3 list-decimal list-outside pl-6 space-y-2 text-slate-700">
          <li>
            Click into a run; download the sealed archive at the link provided. Archives are
            emitted by the Sprint 1.4 evidence reporter — content-hashed ledger + SHA-256 root
            hash.
          </li>
          <li>
            Verify with the partner-side CLI:
            <pre className="mt-2 bg-slate-900 text-slate-100 rounded p-3 text-xs overflow-x-auto">
              <code>bunx tsx scripts/e2e-verify-evidence.ts path/to/archive</code>
            </pre>
            Exit 0 means every file hash matches the ledger AND the root hash matches the seal.
          </li>
          <li>
            Reproduce against state you control — see{' '}
            <a
              className="underline hover:text-ink"
              href="https://consentshield.in/docs/test-verification"
              target="_blank"
              rel="noopener noreferrer"
            >
              /docs/test-verification
            </a>{' '}
            on the marketing site. The partner-bootstrap script walks a full reproduction in
            under 30 minutes on a warm machine.
          </li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink">How entries land here</h2>
        <p className="mt-3 text-slate-700">
          Every entry is a typed literal appended to the git-tracked file{' '}
          <code className="text-slate-900 bg-slate-100 rounded px-1 py-0.5">testing/src/data/runs.ts</code>.
          The site has no runtime data source — it's fully static. That means the PR diff IS
          the publication record: you can see who added which entry, when, and with what
          content-hash.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink">Report an issue</h2>
        <p className="mt-3 text-slate-700">
          Suspect a published run is inconsistent with the code it claims to cover, or with
          your own reproduction? Open an issue on the repo or email{' '}
          <a className="underline hover:text-ink" href="mailto:support@consentshield.in">
            support@consentshield.in
          </a>
          . Include the run id (top of the run's page) and whatever evidence you can share.
        </p>
      </section>

      <p className="mt-10 text-sm text-slate-500">
        <Link href="/" className="underline hover:text-ink">
          ← Back to runs
        </Link>
      </p>
    </article>
  )
}
