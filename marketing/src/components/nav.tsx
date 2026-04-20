'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Logo } from './logo'
import { NAV_LINKS, ROUTES } from '@/lib/routes'

// Sticky site nav with a scroll-triggered bottom border. Replaces the
// data-nav/data-nav click handler + scroll listener from the HTML source —
// active-link state now derives from the Next.js pathname.
export function Nav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`} id="mainNav">
      <div className="nav-inner">
        <Link href={ROUTES.home.href} className="logo-link" aria-label="ConsentShield home">
          <Logo variant="light" />
        </Link>
        <div className="nav-links">
          {NAV_LINKS.map((key) => {
            const r = ROUTES[key]
            const active =
              pathname === r.href || pathname.startsWith(`${r.href}/`)
            return (
              <Link
                key={key}
                href={r.href}
                className={`nav-link${active ? ' active' : ''}`}
              >
                {r.label}
              </Link>
            )
          })}
        </div>
        <div className="nav-right">
          <Link href={ROUTES.contact.href} className="nav-ghost">
            Sign in
          </Link>
          <Link href={ROUTES.contact.href} className="nav-cta">
            Book a demo
          </Link>
        </div>
      </div>
    </nav>
  )
}
