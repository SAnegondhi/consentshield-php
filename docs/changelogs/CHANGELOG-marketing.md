# Changelog — Marketing

Public marketing site (`marketing/` workspace → `consentshield.in`). New in 2026-04-21.

## [ADR-0501 Sprint 1.1] — 2026-04-21

**ADR:** ADR-0501 — ConsentShield marketing site (`marketing/`)
**Sprint:** Sprint 1.1 — Scaffold

### Added
- `marketing/` — Bun workspace sibling of `app/` + `admin/` + `worker/`. Next.js 16.2.3 + React 19.2.5 + TypeScript 5.9.3 + Tailwind v4.2.2 + ESLint 9.39.4. Exact-pinned; no Sentry / no Supabase / no secrets wired.
- `marketing/package.json` — `@consentshield/marketing`; `dev` on port 3002; mirrors admin workspace scripts except the env-isolation prebuild (marketing has no secrets to isolate).
- `marketing/next.config.ts` — minimal; deliberately no `noindex` header (marketing is the one public surface).
- `marketing/src/app/layout.tsx` — DM Sans + DM Mono next/font; Satoshi wordmark stylesheet link; indexable metadata (title, description, Open Graph).
- `marketing/src/app/page.tsx` — placeholder landing explaining the scaffold. Replaced in Phase 2 when user-authored HTML lands.
- `marketing/src/app/globals.css` — Tailwind v4 `@import` + reserved `@theme` block for brand tokens.
- `marketing/src/app/robots.ts` — fully crawlable; sitemap reference at `https://consentshield.in/sitemap.xml`.
- `marketing/public/downloads/.gitkeep` — placeholder for Phase 3 PDF / DOCX / Markdown artefacts.
- `marketing/tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `vercel.json`, `.gitignore` — mirror the admin workspace layout.

### Changed
- Root `package.json` — `workspaces` array adds `"marketing"` between `admin` and `worker`.
- `docs/ADRs/ADR-index.md` — new entry for ADR-0501; added a comment block documenting the reserved ADR number ranges now that the 500-series opens.

### Tested
- [x] `bun install` at repo root — clean; 828 installs across 1029 packages; no hoist conflicts.
- [x] `cd marketing && bun run build` — clean; 4 static routes (`/`, `/_not-found`, `/robots.txt`, types); Turbopack; 1.3s cold.
- [x] `cd marketing && bun run lint` — 0 errors, 0 warnings.

### Deferred (explicit, per ADR-0501)
- Phase 2 — content. Awaits user-authored HTML.
- Phase 3 — PDF / DOCX / MD download pipeline. Tooling (pandoc vs `pdfkit` + `html-to-docx`) decided once Phase 2 is stable.
- Phase 4 — security hardening (CSP, HSTS, Turnstile, Sentry PII strip, BotID, env-isolation prebuild). Deferred per user direction.
