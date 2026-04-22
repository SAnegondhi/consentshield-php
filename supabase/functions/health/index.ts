// Supabase Edge Function: health
// ADR-1018 Sprint 1.4 — unauthenticated liveness for the Edge-Functions
// surface. Used by run-status-probes to verify that the Functions gateway
// can reach a running Deno isolate. No DB round-trip, no secrets.
//
// supabase/config.toml carries verify_jwt = false for this function so the
// probe can hit it without an Authorization header. Named `health` (not
// `_health`) — Supabase rejects Function names starting with an underscore.

Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: true,
      surface: 'edge_functions',
      at: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
})
