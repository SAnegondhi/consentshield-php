import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing · ConsentShield',
  description:
    'Transparent DPDP compliance pricing — Solo, Studio, Growth, Scale. BFSI callout for regulated entities.',
}

export default function PricingPage() {
  return (
    <main id="page-pricing">
      <section className="price-hero">
        <div className="price-hero-inner">
          <span className="eyebrow">Pricing</span>
          <h1 className="display-lg">Transparent. No surprises.</h1>
          <p className="lede">
            Content ships in Sprint 2.4 — monthly/annual toggle, four-tier
            feature table, BFSI callout.
          </p>
        </div>
      </section>
    </main>
  )
}
