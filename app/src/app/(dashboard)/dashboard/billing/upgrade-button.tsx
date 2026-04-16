'use client'

import { useState } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => {
      open: () => void
    }
  }
}

export function UpgradeButton({
  orgId,
  planId,
  planName,
}: {
  orgId: string
  planId: string
  planName: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleUpgrade() {
    setLoading(true)
    setError('')

    const res = await fetch(`/api/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planId }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Checkout failed')
      setLoading(false)
      return
    }

    const data = (await res.json()) as {
      subscription_id: string
      razorpay_key_id: string
      short_url?: string
    }

    if (!window.Razorpay) {
      // Fallback: open Razorpay hosted subscription page
      if (data.short_url) {
        window.location.href = data.short_url
        return
      }
      setError('Razorpay SDK not loaded')
      setLoading(false)
      return
    }

    const rzp = new window.Razorpay({
      key: data.razorpay_key_id,
      subscription_id: data.subscription_id,
      name: 'ConsentShield',
      description: `Upgrade to ${planName}`,
      handler: () => {
        // Payment success — webhook will confirm, redirect to pending
        window.location.href = '/dashboard/billing?status=pending'
      },
      modal: {
        ondismiss: () => setLoading(false),
      },
      theme: { color: '#000000' },
    })
    rzp.open()
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="w-full rounded bg-black px-3 py-2 text-center text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Opening...' : 'Upgrade'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </>
  )
}
