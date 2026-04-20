import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DEPA · ConsentShield',
  description:
    'DEPA-native architecture. Consent as a signed, revocable artefact — not a setting in a CMS.',
}

export default function DepaPage() {
  return (
    <main id="page-depa">
      <section className="depa-hero">
        <div className="depa-hero-bg" aria-hidden="true" />
        <div className="depa-hero-inner">
          <div className="depa-hero-copy">
            <span className="eyebrow">DEPA</span>
            <h1 className="display-lg">
              Consent that the <em>DPB can read</em>.
            </h1>
            <p className="lede">
              Content ships in Sprint 2.3 — DEPA hero, shield mark, and the
              traditional-CMS-vs-DEPA-native comparison table.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
