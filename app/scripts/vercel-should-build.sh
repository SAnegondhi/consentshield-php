#!/usr/bin/env bash
# ADR-0026 Sprint 4.1 — Vercel "Ignored Build Step" for the customer app.
#
# Vercel's convention: the Ignored Build Step command runs before the
# build. Exit 0 = skip the build; exit 1 = proceed with the build.
# Per Vercel docs, `ignoreCommand` runs from the project's Root
# Directory (here: `app/`), NOT from the git repo root. The original
# version of this script passed pathspecs like 'app/' / 'packages/'
# etc. to `git diff`, which git resolved relative to cwd (= app/), so
# they silently matched zero files and every commit exited 0 —
# skipping every deploy (~7 cancellations in a 4-hour window before
# this was diagnosed 2026-04-23). Fixed by cd'ing into the repo root
# before diffing so pathspecs match regardless of cwd.
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

# Move to the git repo root so the pathspecs below are interpreted
# relative to the repo, not to the Vercel Root Directory.
cd "$(git rev-parse --show-toplevel)"

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
