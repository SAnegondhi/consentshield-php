import * as Sentry from '@sentry/nextjs'

// ADR-0501 Phase 4 Sprint 4.3 — browser-side Sentry init.
// See sentry.server.config.ts for the DSN + scrub rationale.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,

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
