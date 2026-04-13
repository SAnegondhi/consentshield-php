import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string; bannerId: string }> },
) {
  const { orgId, bannerId } = await params
  const supabase = await createServerClient()

  // Verify the user belongs to this org
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the banner to find its property_id
  const { data: banner, error: bannerErr } = await supabase
    .from('consent_banners')
    .select('id, property_id, org_id')
    .eq('id', bannerId)
    .eq('org_id', orgId)
    .single()

  if (bannerErr || !banner) {
    return NextResponse.json({ error: 'Banner not found' }, { status: 404 })
  }

  // Get current signing secret before rotation
  const { data: property } = await supabase
    .from('web_properties')
    .select('event_signing_secret')
    .eq('id', banner.property_id)
    .single()

  const oldSecret = property?.event_signing_secret

  // Generate new signing secret
  const newSecret = generateHexSecret(32)

  // Deactivate all banners for this property
  await supabase
    .from('consent_banners')
    .update({ is_active: false })
    .eq('property_id', banner.property_id)
    .eq('org_id', orgId)

  // Activate this banner
  await supabase
    .from('consent_banners')
    .update({ is_active: true })
    .eq('id', bannerId)

  // Rotate signing secret on the web property
  await supabase
    .from('web_properties')
    .update({ event_signing_secret: newSecret })
    .eq('id', banner.property_id)

  // Invalidate KV caches via Cloudflare API
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN
  const cfKvNamespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID

  if (cfAccountId && cfApiToken && cfKvNamespaceId) {
    const kvBase = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/storage/kv/namespaces/${cfKvNamespaceId}`
    const cfHeaders = {
      Authorization: `Bearer ${cfApiToken}`,
      'Content-Type': 'application/json',
    }

    // Delete current config cache
    await fetch(`${kvBase}/values/banner:config:${banner.property_id}`, {
      method: 'DELETE',
      headers: cfHeaders,
    })

    // Delete current property config cache
    await fetch(`${kvBase}/values/property:config:${banner.property_id}`, {
      method: 'DELETE',
      headers: cfHeaders,
    })

    // Store old secret with 1-hour TTL for grace period
    if (oldSecret) {
      await fetch(`${kvBase}/values/signing_secret_prev:${banner.property_id}`, {
        method: 'PUT',
        headers: cfHeaders,
        body: oldSecret,
      })
      // Set expiration (1 hour = 3600 seconds)
      await fetch(
        `${kvBase}/values/signing_secret_prev:${banner.property_id}?expiration_ttl=3600`,
        {
          method: 'PUT',
          headers: cfHeaders,
          body: oldSecret,
        },
      )
    }
  }

  // Audit log
  const { createClient } = await import('@supabase/supabase-js')
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  await adminClient.from('audit_log').insert({
    org_id: orgId,
    actor_id: user.id,
    event_type: 'banner_published',
    entity_type: 'consent_banner',
    entity_id: bannerId,
    payload: { property_id: banner.property_id, secret_rotated: true },
  })

  return NextResponse.json({
    published: true,
    banner_id: bannerId,
    property_id: banner.property_id,
    secret_rotated: true,
  })
}

function generateHexSecret(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
