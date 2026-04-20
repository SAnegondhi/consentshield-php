import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Partners &amp; Contact · ConsentShield',
  description:
    'Book a demo, partner with us, or download the Architecture Brief. No forms-as-gates.',
}

export default function ContactPage() {
  return (
    <main id="page-contact">
      <section className="contact-hero">
        <div className="contact-hero-inner">
          <div className="contact-copy">
            <span className="eyebrow">Partners</span>
            <h1 className="display-lg">Let&apos;s talk.</h1>
            <p className="lede">
              Content ships in Sprint 2.4 — contact options grid + contact
              form. Phase 4 adds Turnstile + BotID before the form goes live.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
