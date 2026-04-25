// Resend OTP-email template. ADR-0502 Sprint 1.1.
//
// Plain HTML + plaintext fallback. No images so the message ships fast
// and doesn't get filtered by spam-image heuristics.

export interface OtpEmailParts {
  subject: string
  text: string
  html: string
}

export function buildOtpEmail(otp: string, recipient: string): OtpEmailParts {
  const subject = `Your ConsentShield preview code: ${otp}`

  const text = [
    'ConsentShield · Confidential preview',
    '',
    'Your sign-in code is',
    '',
    `    ${otp}`,
    '',
    'It expires in 10 minutes. You\'re receiving this because',
    `your email address (${recipient}) is on the`,
    'ConsentShield invited-preview list.',
    '',
    'If you didn\'t request this, you can ignore this email —',
    'the code expires on its own.',
    '',
    '  hello@consentshield.in',
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0F2D5B; background: #F4F6FA; margin: 0; padding: 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; padding: 32px;">
          <tr><td>
            <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #6B7A93; margin: 0 0 8px;">ConsentShield · Confidential preview</p>
            <h1 style="font-size: 18px; margin: 0 0 16px; color: #0F2D5B;">Your sign-in code</h1>
            <p style="font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; font-size: 32px; letter-spacing: 6px; margin: 16px 0; color: #0D7A6B; background: #F0FBF8; padding: 16px; text-align: center; border-radius: 6px;">${escapeHtml(otp)}</p>
            <p style="font-size: 14px; color: #4A5876; line-height: 1.6;">It expires in 10 minutes. You're receiving this because your email address (<strong>${escapeHtml(recipient)}</strong>) is on the ConsentShield invited-preview list.</p>
            <p style="font-size: 14px; color: #4A5876; line-height: 1.6;">If you didn't request this, you can ignore this email — the code expires on its own.</p>
            <p style="font-size: 12px; color: #6B7A93; margin-top: 24px;">hello@consentshield.in</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
