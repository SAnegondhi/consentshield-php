import { cookies } from 'next/headers'
import Link from 'next/link'
import { Logo } from './logo'
import { DOWNLOAD_BRIEF, ROUTES } from '@/lib/routes'
import { COOKIE_SESSION } from '@/lib/gate/cookies'
import { GateLogout } from './gate-logout'

export async function Footer() {
  // ADR-0502 — show "Sign out of preview" only when a gate session is
  // present. The signed-out gate page is served unauthenticated and the
  // link simply doesn't appear there because no session cookie exists.
  const cookieStore = await cookies()
  const hasSession = Boolean(cookieStore.get(COOKIE_SESSION))

  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link
            href={ROUTES.home.href}
            className="logo-link"
            aria-label="ConsentShield home"
          >
            <Logo variant="dark" />
          </Link>
          <p className="footer-tag">
            India&apos;s DPDP compliance enforcement engine. DEPA-native consent
            artefacts, real-time tracker enforcement, stateless oracle
            architecture. Built in Hyderabad for 4,00,000+ Indian businesses.
          </p>
          <div className="footer-badge">
            <span className="footer-badge-dot"></span>DEPA-Native · Hyderabad
          </div>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">Product</div>
          <ul>
            <li>
              <Link href={ROUTES.product.href}>Platform</Link>
            </li>
            <li>
              <Link href={ROUTES.depa.href}>DEPA architecture</Link>
            </li>
            <li>
              <Link href={ROUTES.solutions.href}>Solutions</Link>
            </li>
            <li>
              <Link href={ROUTES.pricing.href}>Pricing</Link>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">Solutions</div>
          <ul>
            <li>
              <Link href={`${ROUTES.solutions.href}#saas`}>SaaS &amp; B2B</Link>
            </li>
            <li>
              <Link href={`${ROUTES.solutions.href}#edtech`}>Edtech</Link>
            </li>
            <li>
              <Link href={`${ROUTES.solutions.href}#d2c`}>
                D2C &amp; e-commerce
              </Link>
            </li>
            <li>
              <Link href={`${ROUTES.solutions.href}#healthcare`}>
                Healthcare (ABDM)
              </Link>
            </li>
            <li>
              <Link href={`${ROUTES.solutions.href}#bfsi`}>
                BFSI (NBFC + Broking)
              </Link>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">Company</div>
          <ul>
            <li>
              <Link href={ROUTES.contact.href}>Book a demo</Link>
            </li>
            <li>
              <Link href={ROUTES.contact.href}>Partners</Link>
            </li>
            <li>
              <Link href={ROUTES.contact.href}>CA firm program</Link>
            </li>
            <li>
              <Link href={ROUTES.contact.href}>Careers</Link>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <div className="footer-col-title">Legal</div>
          <ul>
            <li>
              <Link href={ROUTES.terms.href}>Terms of Service</Link>
            </li>
            <li>
              <Link href={ROUTES.privacy.href}>Privacy Policy</Link>
            </li>
            <li>
              <Link href={ROUTES.dpa.href}>DPA &amp; EU Addendum</Link>
            </li>
            <li>
              <a href={DOWNLOAD_BRIEF.pdf} download>
                Architecture Brief
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <div>© 2026 ConsentShield. All rights reserved.</div>
        <div>
          consentshield.in · Confidential — For prospective customer and
          partner review only.
        </div>
        <div className="footer-bottom-links">
          <Link href={ROUTES.terms.href}>Terms</Link>
          <Link href={ROUTES.privacy.href}>Privacy</Link>
          <Link href={ROUTES.contact.href}>Security</Link>
          {hasSession ? <GateLogout /> : null}
        </div>
      </div>
    </footer>
  )
}
