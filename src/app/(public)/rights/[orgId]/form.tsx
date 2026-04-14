'use client'

import Script from 'next/script'
import { useState, useRef, useEffect } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
        },
      ) => string
      reset: (widgetId?: string) => void
    }
  }
}

type Step = 'form' | 'otp' | 'done'

export function RightsRequestForm({
  orgId,
  orgName,
  turnstileSiteKey,
}: {
  orgId: string
  orgName: string
  turnstileSiteKey: string
}) {
  const [step, setStep] = useState<Step>('form')
  const [requestType, setRequestType] = useState('erasure')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [otp, setOtp] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [requestId, setRequestId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const widgetIdRef = useRef<string | undefined>(undefined)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (step !== 'form') return
    const interval = setInterval(() => {
      if (window.turnstile && turnstileContainerRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => setTurnstileToken(token),
          'error-callback': () => setTurnstileToken(''),
        })
        clearInterval(interval)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [step, turnstileSiteKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/public/rights-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        request_type: requestType,
        requestor_name: name,
        requestor_email: email,
        requestor_message: message || undefined,
        turnstile_token: turnstileToken,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Request failed')
      setLoading(false)
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current)
        setTurnstileToken('')
      }
      return
    }

    const body = await res.json()
    setRequestId(body.request_id)
    setStep('otp')
    setLoading(false)
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/public/rights-request/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, otp }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Verification failed')
      setLoading(false)
      return
    }

    setStep('done')
    setLoading(false)
  }

  if (step === 'done') {
    return (
      <div className="rounded border border-green-200 bg-green-50 p-6">
        <h2 className="font-semibold text-green-800">Request submitted</h2>
        <p className="mt-2 text-sm text-green-700">
          Your {requestType} request to {orgName} is now in their queue. They have 30 days to
          respond under DPDP. You will receive the response at <strong>{email}</strong>.
        </p>
      </div>
    )
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleVerifyOtp} className="space-y-4">
        <div>
          <h2 className="font-semibold">Check your email</h2>
          <p className="mt-1 text-sm text-gray-600">
            We sent a 6-digit code to <strong>{email}</strong>. Enter it to confirm your request.
          </p>
        </div>

        <div>
          <label htmlFor="otp" className="block text-sm font-medium">
            Verification code
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-lg font-mono tracking-widest text-center"
            placeholder="123456"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>
    )
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="type" className="block text-sm font-medium">
            Request type
          </label>
          <select
            id="type"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="erasure">Erasure (delete my data)</option>
            <option value="access">Access (what data do you hold about me?)</option>
            <option value="correction">Correction (update my data)</option>
            <option value="nomination">Nomination</option>
          </select>
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Your name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Your email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-medium">
            Message (optional)
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Any additional context for your request"
          />
        </div>

        <div ref={turnstileContainerRef} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Submit request'}
        </button>

        {!turnstileToken && (
          <p className="text-xs text-gray-500 text-center">Complete the bot check above to continue.</p>
        )}
      </form>
    </>
  )
}
