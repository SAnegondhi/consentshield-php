// ADR-1019 Sprint 2.1 — deliver-consent-events entrypoint.
//
// Bearer-authed internal route. Triggered two ways (Sprint 3.1):
//   · AFTER INSERT on delivery_buffer fires net.http_post → this route with
//     { delivery_buffer_id: <uuid> }. Primary path.
//   · pg_cron every 60 s fires this route with { scan: true } for any rows
//     the trigger missed. Safety net — batch mode ships in Sprint 2.2.
//
// Sprint 2.1 scope: { delivery_buffer_id } only. The scan path returns 501
// until Sprint 2.2 lands.
//
// Runs under cs_delivery (Rule 5 least-privilege). Uses the shared
// STORAGE_PROVISION_SECRET bearer the other internal storage routes use.

import { NextResponse } from 'next/server'
import { csDelivery } from '@/lib/api/cs-delivery-client'
import { deliverBatch, deliverOne } from '@/lib/delivery/deliver-events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Under Fluid Compute the default function timeout is 300s; keep it at
// that cap explicitly so the scan-mode batch has room for its 270s budget.
export const maxDuration = 300

const SECRET = process.env.STORAGE_PROVISION_SECRET ?? ''

interface Body {
  delivery_buffer_id?: unknown
  scan?: unknown
  limit?: unknown
}

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json(
      { error: 'STORAGE_PROVISION_SECRET not configured' },
      { status: 500 },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const pg = csDelivery()

  if (body.scan === true) {
    const rawLimit = typeof body.limit === 'number' ? body.limit : 200
    const limit = Math.max(1, Math.min(500, Math.floor(rawLimit)))
    const summary = await deliverBatch(pg, limit)
    return NextResponse.json(summary)
  }

  const id = body.delivery_buffer_id
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: 'delivery_buffer_id must be a uuid string' },
      { status: 400 },
    )
  }

  const result = await deliverOne(pg, id)

  const statusCode =
    result.outcome === 'delivered' ? 200
      : result.outcome === 'not_found' ? 404
      : result.outcome === 'already_delivered' ? 200
      : 202 // kept: no_export_config / unverified / decrypt_failed / upload_failed / endpoint_failed

  return NextResponse.json(result, { status: statusCode })
}
