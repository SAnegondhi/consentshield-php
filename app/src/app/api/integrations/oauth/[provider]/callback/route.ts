import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { encryptForOrg } from '@consentshield/encryption'
import { getOAuthProvider } from '@/lib/connectors/oauth/registry'

// ADR-0039 — OAuth callback landing. Validates state, exchanges code,
// upserts integration_connectors, redirects back to /dashboard/integrations.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  const providerConfig = getOAuthProvider(provider)
  if (!providerConfig) {
    return redirectError(request, `oauth_not_configured_${provider}`)
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errParam = url.searchParams.get('error')
  if (errParam) return redirectError(request, errParam)
  if (!code || !state) return redirectError(request, 'missing_code_or_state')

  const supabase = await createServerClient()

  // Look up + consume the state row. Single-use.
  const { data: stateRow } = await supabase
    .from('oauth_states')
    .select('org_id, user_id, provider, redirect_uri, consumed_at, expires_at')
    .eq('state', state)
    .maybeSingle()
  if (!stateRow) return redirectError(request, 'unknown_state')
  if (stateRow.consumed_at) return redirectError(request, 'state_already_consumed')
  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    return redirectError(request, 'state_expired')
  }
  if (stateRow.provider !== provider) {
    return redirectError(request, 'state_provider_mismatch')
  }

  // Consume it first — prevents races.
  await supabase
    .from('oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state', state)

  // Also verify the caller is the same user who initiated the flow.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.id !== stateRow.user_id) {
    return redirectError(request, 'user_mismatch')
  }

  let bundle
  try {
    bundle = await providerConfig.exchange_code({
      code,
      redirectUri: stateRow.redirect_uri as string,
    })
  } catch (e) {
    return redirectError(
      request,
      `exchange_failed: ${e instanceof Error ? e.message : 'unknown'}`,
    )
  }

  const encrypted = await encryptForOrg(
    supabase,
    stateRow.org_id as string,
    JSON.stringify(bundle),
  )

  // Find an existing OAuth connector of this type for the org (distinct
  // from any API-key row — we use display_name suffix " (OAuth)" to keep
  // both visible in the integrations list). If present → UPDATE; else
  // → INSERT.
  const oauthDisplayName = `${providerConfig.display_name} (OAuth)`
  const { data: existingOauth } = await supabase
    .from('integration_connectors')
    .select('id')
    .eq('org_id', stateRow.org_id)
    .eq('connector_type', provider)
    .eq('display_name', oauthDisplayName)
    .maybeSingle()

  const commonFields = {
    config: encrypted,
    status: 'active',
    last_health_check_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }

  const writeError = existingOauth
    ? (
        await supabase
          .from('integration_connectors')
          .update(commonFields)
          .eq('id', existingOauth.id)
      ).error
    : (
        await supabase.from('integration_connectors').insert({
          org_id: stateRow.org_id,
          connector_type: provider,
          display_name: oauthDisplayName,
          ...commonFields,
        })
      ).error

  if (writeError) {
    return redirectError(request, `write_failed: ${writeError.message}`)
  }

  return redirectSuccess(request, provider)
}

function redirectError(request: Request, code: string): Response {
  const origin = new URL(request.url).origin
  return NextResponse.redirect(
    `${origin}/dashboard/integrations?oauth_error=${encodeURIComponent(code)}`,
  )
}
function redirectSuccess(request: Request, provider: string): Response {
  const origin = new URL(request.url).origin
  return NextResponse.redirect(
    `${origin}/dashboard/integrations?oauth_connected=${encodeURIComponent(provider)}`,
  )
}
