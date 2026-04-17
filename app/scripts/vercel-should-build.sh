#!/usr/bin/env bash
# ADR-0026 Sprint 4.1 — Vercel "Ignored Build Step" for the customer app.
#
# Vercel's convention: the Ignored Build Step command runs before the
# build. Exit 0 = skip the build; exit 1 = proceed with the build.
#
# Build when changes are in any of:
#   app/**              (this workspace's own source)
#   packages/**         (shared packages — @consentshield/compliance etc.)
#   worker/**           (Worker changes should re-deploy the banner bundle)
#   supabase/**         (schema / Edge Function changes affect customer app)
#   package.json, bun.lock, tsconfig.base.json (workspace-level config)
#
# Do NOT build for admin-only changes, docs, session-context, .wolf, .claude.
#
# Set in Vercel: Settings → Git → Ignored Build Step →
#   `bash app/scripts/vercel-should-build.sh`

set -euo pipefail

# VERCEL_GIT_COMMIT_REF is set by Vercel; on first deploy the ref may
# not have a predecessor. Fall back to HEAD^ and fail-open (build) if
# the diff cannot be computed.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

if ! git diff --quiet "$BASE" HEAD -- 'app/' 'packages/' 'worker/' 'supabase/' 'package.json' 'bun.lock' 'tsconfig.base.json'; then
  echo "Customer app: relevant changes detected — building."
  exit 1
fi

echo "Customer app: no relevant changes — skipping build."
exit 0
