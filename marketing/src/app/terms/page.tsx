import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service · ConsentShield',
  description: 'ConsentShield terms of service.',
}

export default function TermsPage() {
  return (
    <main id="page-terms">
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <span className="eyebrow">Legal</span>
          <h1 className="display-md">Terms of Service</h1>
          <p className="lede">Content ships in Sprint 2.4.</p>
        </div>
      </section>
    </main>
  )
}
