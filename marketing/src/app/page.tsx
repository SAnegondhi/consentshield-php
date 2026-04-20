import type { Metadata } from 'next'

// Sprint 2.1 — placeholder hero using the real design tokens so nav +
// footer + fonts can be sanity-checked before Sprint 2.2 ports the full
// home-page sections (contrast, story, depa-moat, timeline, pricing,
// cta-band) from the HTML spec.
export const metadata: Metadata = {
  title: "ConsentShield — India's DPDP compliance enforcement engine",
  description:
    "ConsentShield is the DEPA-native compliance engine for India's DPDP Act. Collect consent as artefacts, enforce it in real time, prove it with an audit trail the DPB can read.",
}

export default function Home() {
  return (
    <main id="page-home">
      <section className="hero">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-eyebrow-row">
            <span className="hero-pill">
              <span className="hero-pill-dot" />
              DEPA-native · Built in India · Confidential preview
            </span>
          </div>
          <h1 className="display-xl">
            India&apos;s DPDP compliance <em>enforcement engine</em>.
          </h1>
          <p className="hero-lede">
            Most compliance tools ask <em>&ldquo;Have you configured your
            consent banner?&rdquo;</em> and check a box.{' '}
            <strong>
              ConsentShield asks: &ldquo;Is your consent banner actually being
              respected by the third-party scripts on your website right
              now?&rdquo;
            </strong>{' '}
            — and shows you the answer in real time.
          </p>
          <div className="hero-ctas">
            <a href="/contact" className="btn btn-primary">
              Book a demo
            </a>
            <a href="/product" className="btn btn-ghost">
              See the platform
            </a>
          </div>
          <div className="hero-meta">
            <div className="hero-meta-item">
              <span className="hero-meta-label">Stack</span>
              <span className="hero-meta-value">
                DEPA-native · Stateless oracle
              </span>
            </div>
            <div className="hero-meta-item">
              <span className="hero-meta-label">Jurisdiction</span>
              <span className="hero-meta-value">India · DPDP Act 2023</span>
            </div>
            <div className="hero-meta-item">
              <span className="hero-meta-label">Status</span>
              <span className="hero-meta-value">
                Confidential preview — 2026
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
