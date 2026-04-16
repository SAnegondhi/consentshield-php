import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; bannerId: string }> },
) {
  const { orgId, bannerId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const newSecret = generateHexSecret(32)

  // rpc_banner_publish (ADR-0009) verifies auth.uid() membership, flips the
  // active banner, rotates the property's signing secret, writes audit_log,
  // and returns the previous secret so we can store it in Cloudflare KV for
  // the 1-hour HMAC grace period.
  const { data, error } = await supabase.rpc('rpc_banner_publish', {
    p_banner_id: bannerId,
    p_org_id: orgId,
    p_new_signing_secret: newSecret,
  })

  if (error) {
    const code = error.code
    if (code === '28000') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as { ok: boolean; error?: string; property_id?: string; old_secret?: string }
  if (!envelope.ok) {
    return NextResponse.json({ error: envelope.error ?? 'Publish failed' }, { status: 404 })
  }

  const propertyId = envelope.property_id!
  const oldSecret = envelope.old_secret

  // Invalidate KV caches via Cloudflare API. Best-effort — cache will expire
  // on its own.
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN
  const cfKvNamespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID

  if (cfAccountId && cfApiToken && cfKvNamespaceId) {
    const kvBase = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/storage/kv/namespaces/${cfKvNamespaceId}`
    const cfHeaders = {
      Authorization: `Bearer ${cfApiToken}`,
      'Content-Type': 'application/json',
    }

    await fetch(`${kvBase}/values/banner:config:${propertyId}`, {
      method: 'DELETE',
      headers: cfHeaders,
    })
    await fetch(`${kvBase}/values/property:config:${propertyId}`, {
      method: 'DELETE',
      headers: cfHeaders,
    })

    if (oldSecret) {
      await fetch(
        `${kvBase}/values/signing_secret_prev:${propertyId}?expiration_ttl=3600`,
        {
          method: 'PUT',
          headers: cfHeaders,
          body: oldSecret,
        },
      )
    }
  }

  return NextResponse.json({
    published: true,
    banner_id: bannerId,
    property_id: propertyId,
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
