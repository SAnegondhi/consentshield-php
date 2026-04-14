// Cloudflare Turnstile server-side verification
// Dev uses Cloudflare's always-pass test keys when real keys are absent.

const TURNSTILE_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Cloudflare test secret that always passes — used when TURNSTILE_SECRET_KEY is unset.
const ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA'

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'Missing Turnstile token' }

  const secret = process.env.TURNSTILE_SECRET_KEY || ALWAYS_PASS_SECRET

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.append('remoteip', remoteIp)

  try {
    const res = await fetch(TURNSTILE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      return { ok: false, error: `Turnstile endpoint returned ${res.status}` }
    }

    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }

    return {
      ok: false,
      error: `Turnstile rejected: ${(data['error-codes'] ?? []).join(', ') || 'unknown'}`,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Turnstile network error' }
  }
}
