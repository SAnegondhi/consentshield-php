'use client'

import { useEffect, useState } from 'react'
import { setOnboardingStep } from '../actions'

const CDN_URL =
  process.env.NEXT_PUBLIC_CDN_URL ?? 'https://cdn.consentshield.in'

interface Property {
  id: string
  url: string
  snippet_verified_at: string | null
}

type Stage = 'url' | 'snippet' | 'verifying' | 'verified'

export function Step5Deploy({
  orgId,
  onComplete,
}: {
  orgId: string
  onComplete: () => void
}) {
  const [stage, setStage] = useState<Stage>('url')
  const [siteUrl, setSiteUrl] = useState('')
  const [property, setProperty] = useState<Property | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Preload: if the org already has a property (e.g. wizard refresh),
  // use the first one.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/orgs/${orgId}/properties`)
      .then((r) => r.json() as Promise<{ properties?: Property[] }>)
      .then((json) => {
        if (cancelled) return
        const first = json.properties?.[0]
        if (first) {
          setProperty(first)
          setSiteUrl(first.url)
          setStage(first.snippet_verified_at ? 'verified' : 'snippet')
        }
      })
      .catch(() => {
        /* non-fatal — user will create a property below */
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function handleCreateProperty(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    let parsed: URL
    try {
      parsed = new URL(siteUrl.trim())
    } catch {
      setError('Enter a valid URL like https://example.com')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Only http:// or https:// URLs are allowed.')
      return
    }

    setLoading(true)
    const res = await fetch(`/api/orgs/${orgId}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: parsed.hostname,
        url: parsed.toString(),
        allowed_origins: [parsed.origin],
      }),
    })
    setLoading(false)
    const json = (await res.json()) as
      | { property: Property }
      | { error: string }
    if (!res.ok || !('property' in json)) {
      setError('error' in json ? json.error : `HTTP ${res.status}`)
      return
    }
    setProperty(json.property)
    setStage('snippet')
  }

  async function handleVerify() {
    if (!property) return
    setStage('verifying')
    setError('')
    const res = await fetch(
      `/api/orgs/${orgId}/onboarding/verify-snippet`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ property_id: property.id, url: property.url }),
      },
    )
    const json = (await res.json()) as {
      verified: boolean
      reason?: string
      verified_at?: string
    }
    if (!json.verified) {
      setError(friendlyReason(json.reason))
      setStage('snippet')
      return
    }

    const step = await setOnboardingStep(orgId, 5)
    if (!step.ok) {
      setError(step.error)
      setStage('snippet')
      return
    }
    setStage('verified')
    onComplete()
  }

  async function handleSkip() {
    setError('')
    setLoading(true)
    const step = await setOnboardingStep(orgId, 5)
    setLoading(false)
    if (!step.ok) {
      setError(step.error)
      return
    }
    onComplete()
  }

  const snippet =
    property !== null
      ? `<script async src="${CDN_URL}/v1/banner.js?org=${orgId}&prop=${property.id}"></script>`
      : ''

  async function handleCopy() {
    if (!snippet) return
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Install the banner</h1>
      <p className="mt-2 text-sm text-gray-600">
        Drop the snippet into your site&apos;s <code>&lt;head&gt;</code>. We
        fetch your home page and confirm the script is loading.
      </p>

      {stage === 'url' ? (
        <form onSubmit={handleCreateProperty} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700"
            >
              Your website URL
            </label>
            <input
              id="url"
              type="url"
              required
              placeholder="https://example.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
            />
            <p className="mt-1 text-xs text-gray-500">
              Use the address where visitors actually land.
            </p>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Setting up…' : 'Continue'}
          </button>
        </form>
      ) : null}

      {stage === 'snippet' || stage === 'verifying' ? (
        <div className="mt-6 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Snippet for <strong>{property?.url}</strong>
            </p>
            <div className="relative mt-2">
              <pre className="overflow-x-auto rounded bg-gray-900 p-4 text-xs text-gray-100">
                <code>{snippet}</code>
              </pre>
              <button
                type="button"
                onClick={handleCopy}
                className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-white hover:bg-gray-600"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {error ? (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleVerify}
              disabled={stage === 'verifying'}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {stage === 'verifying'
                ? 'Checking your site…'
                : 'Verify installation'}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={loading || stage === 'verifying'}
              className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              {loading ? 'Skipping…' : "I'll do this later →"}
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Verification fetches <strong>{property?.url}</strong> from our
            server and looks for <code>banner.js</code>. Private networks,
            localhost, and cloud-metadata endpoints are refused.
          </p>
        </div>
      ) : null}

      {stage === 'verified' ? (
        <div className="mt-6 rounded border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          Snippet verified on <strong>{property?.url}</strong>. Moving on to
          your DEPA score.
        </div>
      ) : null}
    </div>
  )
}

function friendlyReason(reason: string | undefined): string {
  switch (reason) {
    case 'snippet_not_found':
      return "We fetched your page but didn't see the ConsentShield banner script. Double-check it's in the <head>."
    case 'timeout':
      return 'Your site took longer than 5 seconds to respond. Try again in a moment.'
    case 'private_ip':
    case 'blocked_host':
      return "That URL resolves to a private or internal address — we can't verify from outside your network."
    case 'unsupported_scheme':
      return 'Use a full https:// URL.'
    case 'invalid_url':
      return 'That URL is not valid.'
    case 'dns_failure':
      return "DNS didn't resolve that hostname."
    case 'fetch_failed':
      return "We couldn't reach the page. Is it publicly accessible?"
    case 'empty_response':
      return 'Your site returned an empty response.'
    default:
      if (reason?.startsWith('http_')) {
        return `Your site returned ${reason.slice(5)}.`
      }
      if (reason?.startsWith('redirect_not_followed_')) {
        return 'Your home page redirects. Point to the final landing page.'
      }
      return `Verification failed: ${reason ?? 'unknown reason'}.`
  }
}
