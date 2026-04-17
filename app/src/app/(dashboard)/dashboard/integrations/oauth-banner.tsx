// Client banner for OAuth callback outcomes. Server component passes the
// query-string flags in; this lives as a client component only because it
// has a dismiss interaction.

'use client'

import { useState } from 'react'

export function OAuthBanner({
  connected,
  error,
}: {
  connected: string | null
  error: string | null
}) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  if (connected) {
    return (
      <div className="flex items-start justify-between rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
        <div>
          <strong>Connected {connected}</strong> via OAuth. Tokens will refresh
          automatically. Verify the connector in the table below.
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="ml-3 text-xs text-green-900 hover:text-green-700"
        >
          Dismiss
        </button>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-start justify-between rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <div>
          OAuth failed: <code className="font-mono">{error}</code>. If this says{' '}
          <code className="font-mono">oauth_not_configured</code>, the operator must set
          the provider&apos;s OAuth client id + secret env vars on the deployment.
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="ml-3 text-xs text-red-900 hover:text-red-700"
        >
          Dismiss
        </button>
      </div>
    )
  }
  return null
}
