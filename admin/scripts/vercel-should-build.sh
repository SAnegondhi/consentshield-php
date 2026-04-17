#!/usr/bin/env bash
# ADR-0026 Sprint 4.1 — Vercel "Ignored Build Step" for the admin app.
#
# Exit 0 = skip the build; exit 1 = proceed with the build.
#
# Build when changes are in any of:
#   admin/**            (this workspace's own source)
#   packages/**         (shared packages — @consentshield/shared-types etc.)
#   supabase/**         (admin consumes admin.* RPCs — schema changes matter)
#   package.json, bun.lock, tsconfig.base.json
#
# Do NOT build for customer-only changes (app/**), worker-only changes
# (worker/**), docs, session-context, .wolf, .claude.
#
# Set in Vercel: Settings → Git → Ignored Build Step →
#   `bash admin/scripts/vercel-should-build.sh`

set -euo pipefail

BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

if ! git diff --quiet "$BASE" HEAD -- 'admin/' 'packages/' 'supabase/' 'package.json' 'bun.lock' 'tsconfig.base.json'; then
  echo "Admin app: relevant changes detected — building."
  exit 1
fi

echo "Admin app: no relevant changes — skipping build."
exit 0
