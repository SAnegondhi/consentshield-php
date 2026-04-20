import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy · ConsentShield',
  description: 'ConsentShield privacy policy.',
}

export default function PrivacyPage() {
  return (
    <main id="page-privacy">
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <span className="eyebrow">Legal</span>
          <h1 className="display-md">Privacy Policy</h1>
          <p className="lede">Content ships in Sprint 2.4.</p>
        </div>
      </section>
    </main>
  )
}
