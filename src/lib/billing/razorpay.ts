// Razorpay API client (server-side)
// Uses HTTP Basic auth with RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET

const RAZORPAY_API = 'https://api.razorpay.com/v1'

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  }
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
}

export interface RazorpaySubscription {
  id: string
  status: string
  plan_id: string
  short_url?: string
  current_start?: number
  current_end?: number
}

export async function createSubscription(params: {
  planId: string
  totalCount?: number
  notes?: Record<string, string>
  customerNotify?: boolean
}): Promise<RazorpaySubscription> {
  const res = await fetch(`${RAZORPAY_API}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: params.planId,
      total_count: params.totalCount ?? 12, // monthly × 12 = 1 year default
      customer_notify: params.customerNotify ? 1 : 0,
      notes: params.notes,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay createSubscription failed: ${res.status} ${text}`)
  }

  return (await res.json()) as RazorpaySubscription
}

export async function cancelSubscription(subscriptionId: string, cancelAtCycleEnd = true): Promise<void> {
  const res = await fetch(
    `${RAZORPAY_API}/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay cancelSubscription failed: ${res.status} ${text}`)
  }
}

// HMAC-SHA256 webhook signature verification
import { createHmac } from 'node:crypto'

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string = process.env.RAZORPAY_WEBHOOK_SECRET || '',
): boolean {
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  if (expected.length !== signature.length) return false
  // Timing-safe compare
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}
