import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DPA &amp; EU Addendum · ConsentShield',
  description:
    'ConsentShield Data Processing Agreement and EU Addendum. Digital execution supported.',
}

export default function DpaPage() {
  return (
    <main id="page-dpa">
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <span className="eyebrow">Legal</span>
          <h1 className="display-md">DPA &amp; EU Addendum</h1>
          <p className="lede">
            Content ships in Sprint 2.4 — DPA body + digital execution block.
          </p>
        </div>
      </section>
    </main>
  )
}
