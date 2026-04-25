'use client'

// ADR-0502 Sprint 1.3 — two-screen email + OTP form.
//
// Wireframe spec: docs/design/marketing-gate-otp-wireframe.md.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  from: string
}

type Phase = 'email' | 'otp' | 'verifying' | 'sending'

export function GateForm({ from }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const otpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'otp') otpRef.current?.focus()
  }, [phase])

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setError(null)
    setInfo(null)
    setPhase('sending')
    try {
      const res = await fetch('/api/gate/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        setError("Couldn't reach the server. Try again.")
        setPhase('email')
        return
      }
      setInfo(null)
      setPhase('otp')
    } catch {
      setError("Couldn't reach the server. Try again.")
      setPhase('email')
    }
  }

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) return
    setError(null)
    setPhase('verifying')
    try {
      const res = await fetch('/api/gate/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp, from }),
      })
      const json = (await res.json()) as { ok: boolean; redirect?: string; reason?: string; attemptsRemaining?: number }
      if (json.ok && json.redirect) {
        router.replace(json.redirect)
        return
      }
      setOtp('')
      setPhase('otp')
      switch (json.reason) {
        case 'mismatch':
          setError(json.attemptsRemaining ? `That code didn't match. ${json.attemptsRemaining} attempt${json.attemptsRemaining === 1 ? '' : 's'} left.` : "That code didn't match.")
          break
        case 'attempts_exhausted':
          setError('Too many wrong attempts. Send a new code.')
          break
        case 'expired':
        case 'no_pending':
        case 'malformed':
        case 'malformed_payload':
        case 'header_mismatch':
        case 'signature':
          setError('Your code expired. Send a new one.')
          break
        default:
          setError("Couldn't verify. Try again or send a new code.")
      }
    } catch {
      setError("Couldn't reach the server. Try again.")
      setPhase('otp')
    }
  }

  const resendOtp = async () => {
    if (!email) {
      setPhase('email')
      return
    }
    setError(null)
    setInfo(null)
    setPhase('sending')
    try {
      const res = await fetch('/api/gate/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        setError("Couldn't reach the server. Try again.")
        setPhase('otp')
        return
      }
      setInfo('New code sent.')
      setOtp('')
      setPhase('otp')
    } catch {
      setError("Couldn't reach the server. Try again.")
      setPhase('otp')
    }
  }

  const useDifferentEmail = () => {
    setOtp('')
    setError(null)
    setInfo(null)
    setPhase('email')
  }

  if (phase === 'email' || phase === 'sending') {
    return (
      <form className="gate-card" onSubmit={submitEmail} noValidate>
        <span className="gate-eyebrow">Confidential preview</span>
        <h1 className="gate-title">Sign in to ConsentShield</h1>
        <p className="gate-lede">
          Enter the email address your invitation was sent to. We&apos;ll mail
          you a 6-digit code valid for 10 minutes.
        </p>
        <label className="gate-label" htmlFor="gate-email">
          Invitation email
        </label>
        <input
          id="gate-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          className="gate-input"
          placeholder="name@company.com"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          disabled={phase === 'sending'}
        />
        {error ? (
          <p className="gate-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="gate-btn" disabled={phase === 'sending' || email.length === 0}>
          {phase === 'sending' ? 'Sending…' : 'Send me the code'}
        </button>
        <p className="gate-help">
          Lost your invitation? Email{' '}
          <a href="mailto:hello@consentshield.in">hello@consentshield.in</a>.
        </p>
      </form>
    )
  }

  return (
    <form className="gate-card" onSubmit={submitOtp} noValidate>
      <span className="gate-eyebrow">Confidential preview</span>
      <h1 className="gate-title">Check your inbox</h1>
      <p className="gate-lede">
        We sent a 6-digit code to <strong>{email}</strong>. It expires in 10
        minutes.
      </p>
      <label className="gate-label" htmlFor="gate-otp">
        6-digit code
      </label>
      <input
        ref={otpRef}
        id="gate-otp"
        name="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        className="gate-input gate-input-otp"
        placeholder="000000"
        value={otp}
        onChange={(ev) => setOtp(ev.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={phase === 'verifying'}
      />
      {info ? (
        <p className="gate-info" role="status">
          {info}
        </p>
      ) : null}
      {error ? (
        <p className="gate-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="gate-btn" disabled={phase === 'verifying' || otp.length !== 6}>
        {phase === 'verifying' ? 'Verifying…' : 'Verify'}
      </button>
      <p className="gate-help">
        Didn&apos;t get it?{' '}
        <button type="button" className="gate-link" onClick={resendOtp} disabled={phase === 'verifying'}>
          Send a new code
        </button>
      </p>
      <p className="gate-help">
        Wrong email?{' '}
        <button type="button" className="gate-link" onClick={useDifferentEmail} disabled={phase === 'verifying'}>
          Use a different one
        </button>
      </p>
    </form>
  )
}
