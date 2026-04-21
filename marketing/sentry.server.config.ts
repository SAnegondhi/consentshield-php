import * as Sentry from '@sentry/nextjs'

// ADR-0501 Phase 4 Sprint 4.3 — server-side Sentry init.
//
// DSN comes from NEXT_PUBLIC_SENTRY_DSN so client + server share one
// env var per environment. Sentry DSNs are public by design.
//
// `beforeSend` strips everything that could carry personal data (per
// CLAUDE.md Rule 18). Only stack traces + error messages reach Sentry.
// `beforeBreadcrumb` applies the same scrub to outbound HTTP breadcrumbs
// (rarely useful on a mostly-static site, but cheap to keep consistent).

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enableLogs: false,

  beforeSend(event) {
    if (event.request) {
      delete event.request.headers
      delete event.request.cookies
      delete event.request.data
      delete event.request.query_string
    }
    return event
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === 'http' && breadcrumb.data) {
      delete breadcrumb.data.request_body
      delete breadcrumb.data.response_body
    }
    return breadcrumb
  },
})
