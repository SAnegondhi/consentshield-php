'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TURNSTILE_SITE_KEY } from '@/lib/env'

// Contact form — Sprint 4.2 wiring.
//
// On submit: serialise FormData (includes the Turnstile-injected
// `cf-turnstile-response` token), POST to /api/contact, flip to the
// acknowledgement state on 202, surface a plain message on 4xx/5xx.
//
// Turnstile: the `/turnstile/v0/api.js` widget script is loaded once
// the form mounts. It auto-renders any `.cf-turnstile` div. Dev falls
// back to Cloudflare's always-pass test pair (see src/lib/env.ts).

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js'

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (submitted) return
    // Guard against double-inject when the component re-renders.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT}"]`,
    )
    if (existing) return

    const s = document.createElement('script')
    s.src = TURNSTILE_SCRIPT
    s.async = true
    s.defer = true
    document.body.appendChild(s)
    // Intentionally NOT removed on unmount — the widget may outlive
    // a React dev-mode double-mount cycle.
  }, [submitted])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return

    const form = e.currentTarget
    const data = new FormData(form)
    const body: Record<string, string> = {}
    data.forEach((v, k) => {
      body[k] = typeof v === 'string' ? v : ''
    })

    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 202) {
        setSubmitted(true)
        return
      }
      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null
      setError(
        payload?.error ??
          'Submission could not be delivered. Please email hello@consentshield.in.',
      )
    } catch {
      setError(
        'Network error. Please retry, or email hello@consentshield.in.',
      )
    } finally {
      setPending(false)
    }
  }

  if (submitted) {
    return (
      <form
        className="contact-form"
        onSubmit={(e) => e.preventDefault()}
        aria-live="polite"
        style={{ textAlign: 'center' }}
      >
        <h3
          style={{
            fontFamily: 'var(--display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--navy)',
            letterSpacing: '-.02em',
            marginBottom: 12,
          }}
        >
          Thanks — we&apos;ll be in touch.
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          A ConsentShield operator will reply within one working day. In the
          meantime, the Architecture Brief covers most technical questions
          standalone.
        </p>
      </form>
    )
  }

  return (
    <form className="contact-form" onSubmit={onSubmit} ref={formRef}>
      <div className="form-row">
        <div className="form-field">
          <label className="form-label" htmlFor="first-name">
            First name
          </label>
          <input
            id="first-name"
            name="firstName"
            className="form-input"
            type="text"
            placeholder="Priya"
            autoComplete="given-name"
            required
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="last-name">
            Last name
          </label>
          <input
            id="last-name"
            name="lastName"
            className="form-input"
            type="text"
            placeholder="Iyer"
            autoComplete="family-name"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="work-email">
            Work email
          </label>
          <input
            id="work-email"
            name="email"
            className="form-input"
            type="email"
            placeholder="priya@company.in"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label className="form-label" htmlFor="company">
            Company
          </label>
          <input
            id="company"
            name="company"
            className="form-input"
            type="text"
            placeholder="Your company"
            autoComplete="organization"
            required
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="role">
            Role
          </label>
          <input
            id="role"
            name="role"
            className="form-input"
            type="text"
            placeholder="Head of Compliance"
            autoComplete="organization-title"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="interest">
            I&apos;m interested in
          </label>
          <select
            id="interest"
            name="interest"
            className="form-select"
            defaultValue="Booking a product demo"
          >
            <option>Booking a product demo</option>
            <option>Partnership conversation</option>
            <option>CA / legal firm program</option>
            <option>Technical architecture walkthrough</option>
            <option>BFSI specialist track</option>
            <option>Healthcare / ABDM bundle</option>
            <option>Something else</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="notes">
            Anything else we should know
          </label>
          <textarea
            id="notes"
            name="notes"
            className="form-textarea"
            placeholder="Team size, current compliance setup, timeline, specific questions…"
          />
        </div>
      </div>

      <div style={{ marginTop: 18, marginBottom: 6 }}>
        <div
          className="cf-turnstile"
          data-sitekey={TURNSTILE_SITE_KEY}
          data-theme="light"
          aria-label="Human-verification challenge"
        />
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            margin: '14px 0 4px',
            padding: '10px 14px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 7,
            color: '#B91C1C',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={pending}
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: 14,
          marginTop: 14,
          opacity: pending ? 0.7 : 1,
          cursor: pending ? 'wait' : 'pointer',
        }}
      >
        {pending ? 'Sending…' : 'Send — we reply within one working day'}
        {!pending ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7h8m0 0L7.5 3.5M11 7L7.5 10.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
      <p
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          marginTop: 14,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        Confidential — for prospective customer and partner review only.
        <br />
        ConsentShield, Hyderabad, India.
      </p>
    </form>
  )
}
