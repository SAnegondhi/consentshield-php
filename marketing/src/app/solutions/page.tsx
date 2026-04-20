import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Solutions · ConsentShield',
  description:
    'DPDP compliance by sector — SaaS &amp; B2B, Edtech, D2C &amp; e-commerce, Healthcare (ABDM), BFSI (NBFC + Broking).',
}

export default function SolutionsPage() {
  return (
    <main id="page-solutions">
      <section className="sol-hero">
        <div className="sol-hero-inner">
          <span className="eyebrow">Solutions</span>
          <h1 className="display-lg">Built for your sector.</h1>
          <p className="lede">
            Content ships in Sprint 2.3 — per-sector tabs (SaaS, Edtech, D2C,
            Healthcare, BFSI) with scenario + stats + feature grid.
          </p>
        </div>
      </section>
    </main>
  )
}
