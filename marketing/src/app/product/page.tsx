import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Product · ConsentShield',
  description:
    'The platform — banner builder, Cloudflare Worker tracker enforcement, stateless buffer pipeline, customer-owned audit trail, and DEPA consent artefacts.',
}

export default function ProductPage() {
  return (
    <main id="page-product">
      <section className="product-hero">
        <div className="product-hero-inner">
          <span className="eyebrow">Platform</span>
          <h1 className="display-lg">The platform.</h1>
          <p className="lede">
            Content ships in Sprint 2.2. Four capability layers: Banner &amp;
            Artefacts, Worker &amp; Enforcement, Buffer Pipeline &amp; Oracle,
            API &amp; Portal. Plus the Architecture Brief download.
          </p>
        </div>
      </section>
    </main>
  )
}
