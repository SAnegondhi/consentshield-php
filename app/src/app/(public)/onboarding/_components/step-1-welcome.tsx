'use client'

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/browser'
import { OtpBoxes } from '@/components/otp-boxes'
import type { InvitePreview } from './wizard-types'

type Stage = 'form' | 'code' | 'accepting'

interface AcceptResult {
  ok?: boolean
  account_id?: string | null
  org_id?: string | null
}

export function Step1Welcome({
  preview,
  token,
  onComplete,
}: {
  preview: InvitePreview
  token: string
  onComplete: (ctx: { orgId: string; accountId: string; orgName: string }) => void
}) {
  const [stage, setStage] = useState<Stage>('form')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createBrowserClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: preview.invited_email,
      options: {
        shouldCreateUser: true,
        data: { invite_token: token },
      },
    })
    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }
    setStage('code')
    setLoading(false)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createBrowserClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: preview.invited_email,
      token: code.trim(),
      type: 'email',
    })
    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    setStage('accepting')

    const { data: accepted, error: acceptError } = await supabase.rpc(
      'accept_invitation',
      { p_token: token },
    )
    if (acceptError) {
      setError(acceptError.message)
      setStage('form')
      setLoading(false)
      return
    }

    // Pull the fresh JWT so current_org_id() works in subsequent RPCs.
    await supabase.auth.refreshSession()

    const result = (accepted ?? {}) as AcceptResult
    const orgId = result.org_id ?? null
    const accountId = result.account_id ?? null
    if (!orgId || !accountId) {
      setError('Account created but the server returned no org reference.')
      setStage('form')
      setLoading(false)
      return
    }

    onComplete({
      orgId,
      accountId,
      orgName: preview.default_org_name ?? preview.invited_email.split('@')[0],
    })
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Welcome to ConsentShield</h1>
      <p className="mt-2 text-sm text-gray-600">
        Let&apos;s set up your account. This will take about two minutes.
      </p>

      <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
        <p>
          Setting up <strong>{preview.invited_email}</strong>
          {preview.default_org_name ? (
            <>
              {' '}
              · Org: <strong>{preview.default_org_name}</strong>
            </>
          ) : null}
          {preview.plan_code ? (
            <>
              {' '}
              · Plan: <code className="font-mono">{preview.plan_code}</code>
            </>
          ) : null}
        </p>
      </div>

      {stage === 'form' ? (
        <form onSubmit={handleRequestCode} className="mt-6 space-y-4">
          <p className="text-sm text-gray-700">
            We&apos;ll email a one-time code to confirm this is you. No
            password required.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <p className="text-sm text-gray-600">
            We sent a code to <strong>{preview.invited_email}</strong>. It
            expires in 1 hour.
          </p>
          <OtpBoxes value={code} onChange={setCode} autoFocus />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading || stage === 'accepting'}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {stage === 'accepting'
              ? 'Creating your account…'
              : loading
                ? 'Verifying…'
                : 'Verify and continue'}
          </button>
        </form>
      )}
    </div>
  )
}
