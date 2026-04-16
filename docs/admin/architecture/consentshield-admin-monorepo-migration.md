# ConsentShield — Monorepo Migration Plan

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Step-by-step plan to convert the single-app repo into a Bun workspace monorepo · April 2026*
*Companion to: [`consentshield-admin-platform.md`](./consentshield-admin-platform.md)*

---

## 0. Why this document exists

The admin platform is a separate Next.js app deployed to a separate Vercel project. Both apps share most of the Supabase project, the Cloudflare Worker, the docs, and a meaningful slice of TypeScript code (shared types, Supabase client utilities, encryption helpers, compliance score calculation, shadcn/ui components). The cleanest way to share that code without copy-paste drift is a Bun workspace monorepo. This document is the one-shot restructuring plan that produces it.

The migration is mechanical, fully reversible until commit, and unblocks both:

- The admin platform implementation (which expects to live in `admin/`)
- The DEPA ADR roadmap (which benefits from the workspace because shared code already lives in one place)

The DEPA roadmap is NOT blocked on this migration — DEPA can ship first with the existing layout if priority demands. But if both streams are active, restructure first.

---

## 1. Target end state

```
consent-sheild/                              # Workspace root
├── app/                                     # ← Customer-facing Next.js (was: repo root)
│   ├── src/                                 # Moved from /src
│   │   ├── app/                             # Next.js App Router
│   │   ├── components/
│   │   ├── lib/                             # App-specific logic only; shared code moves to packages/
│   │   ├── proxy.ts
│   │   └── types/
│   ├── tests/                               # App-specific tests (moved from /tests where applicable)
│   ├── package.json                         # App dependencies (Next, React, Sentry, Supabase, etc.)
│   ├── next.config.ts
│   ├── tsconfig.json                        # extends ../tsconfig.base.json
│   ├── eslint.config.mjs                    # imports from root
│   ├── postcss.config.mjs
│   ├── sentry.client.config.ts
│   ├── sentry.server.config.ts
│   └── vitest.config.ts
│
├── admin/                                   # ← NEW: Operator-facing Next.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── (operator)/                  # Protected admin routes
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx                 # Operations Dashboard
│   │   │   │   ├── orgs/
│   │   │   │   ├── sectoral-templates/
│   │   │   │   ├── connectors/
│   │   │   │   ├── tracker-signatures/
│   │   │   │   ├── support-tickets/
│   │   │   │   ├── pipeline-ops/
│   │   │   │   ├── billing-ops/
│   │   │   │   ├── abuse-security/
│   │   │   │   ├── feature-flags/
│   │   │   │   └── audit-log/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/
│   │   │   │   └── register-hardware-key/
│   │   │   └── api/
│   │   │       ├── admin/                   # Admin API routes
│   │   │       └── auth/                    # Supabase auth callbacks
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── admin-rpc.ts                 # Wrapper around supabase RPC for admin functions
│   │   │   └── impersonation.ts
│   │   ├── proxy.ts                         # Host check + AAL2 + is_admin gate (per admin platform doc §3.2)
│   │   └── types/
│   ├── tests/
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   ├── postcss.config.mjs
│   ├── sentry.client.config.ts
│   ├── sentry.server.config.ts
│   └── vitest.config.ts
│
├── worker/                                  # Cloudflare Worker (unchanged location)
│   ├── src/
│   ├── wrangler.toml
│   └── tsconfig.json
│
├── packages/                                # ← NEW: 3 narrowly-shared workspace packages
│   ├── shared-types/                        # Types derived from the Postgres schema (one canonical source)
│   │   ├── src/
│   │   │   ├── consent.ts
│   │   │   ├── artefacts.ts
│   │   │   ├── billing.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── compliance/                          # Deterministic compliance logic (DPDP + DEPA score, privacy notice)
│   │   ├── src/
│   │   │   ├── dpdp-score.ts
│   │   │   ├── depa-score.ts
│   │   │   ├── privacy-notice.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── encryption/                          # Per-org key derivation (review when ADR-0027 lands)
│       ├── src/
│       │   ├── crypto.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
│   # Deliberately NOT shared (each app keeps its own copy under src/lib/ or src/components/):
│   #   - Supabase server/browser clients — different roles, different claim checks, different schema targets per app
│   #   - shadcn/ui components — shadcn's design is copy-paste-into-codebase, not consume-as-library;
│   #     both apps run `bunx shadcn@latest add` against the same Tailwind tokens independently
│   #   - App-specific lib code (billing/, rights/, admin RPCs)
│
├── supabase/                                # Migrations + Edge Functions  (unchanged)
│   ├── migrations/
│   ├── functions/
│   └── seed.sql
│
├── tests/                                   # Cross-app integration tests (admin RLS, etc.)
│   ├── rls/                                 # Existing RLS isolation tests (multi-tenant)
│   └── admin/                               # NEW: admin RLS, audit-log invariants, impersonation
│
├── docs/                                    # Shared docs  (unchanged + new admin/ subdir from previous task)
├── scripts/                                 # Cross-app scripts  (unchanged)
├── test-sites/                              # Demo customer sites  (unchanged)
├── session-context/                         # Unchanged
├── .wolf/                                   # Unchanged
├── .claude/                                 # Unchanged
├── package.json                             # ← Workspace root
├── tsconfig.base.json                       # ← Shared TS settings
├── eslint.config.mjs                        # ← Shared lint settings (each app extends)
├── .prettierrc
├── .gitignore
├── bun.lock                                 # Single lockfile for the whole workspace
├── CLAUDE.md
└── README.md
```

---

## 2. Workspace tooling decision

**Bun workspaces.** The repo already uses Bun (`bun.lock` present, `bunx` used throughout). Bun's native workspace support is sufficient for this project — no need for Turborepo or Nx. Future scale may justify Turbo for shared task caching across packages, but for two apps + six small packages, native Bun workspaces keep the toolchain minimal.

Workspace root `package.json`:

```jsonc
{
  "name": "consentshield-monorepo",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "app",
    "admin",
    "packages/*",
    "worker"
  ],
  "scripts": {
    "dev:app": "bun --filter app run dev",
    "dev:admin": "bun --filter admin run dev",
    "build:app": "bun --filter app run build",
    "build:admin": "bun --filter admin run build",
    "build:all": "bun run build:app && bun run build:admin",
    "lint": "bun --filter '*' run lint",
    "test": "bun --filter '*' run test",
    "test:rls": "bun --cwd tests/rls test",
    "test:admin": "bun --cwd tests/admin test",
    "typecheck": "bun --filter '*' run typecheck"
  },
  "devDependencies": {
    "prettier": "3.8.2",
    "typescript": "5.9.3",
    "@types/node": "20.19.39"
  }
}
```

Each `packages/*/package.json` declares the dependency in the consumer apps as e.g. `"@consentshield/shared-types": "workspace:*"`.

---

## 3. Migration phases

The migration is structured as 6 phases. Each phase is independently committable and the repo builds at the end of each phase. The whole migration is one ADR (proposed: ADR-0026) with 6 sprints.

### Phase 1 — Workspace bootstrap (~30 min)

**Goal:** create the workspace root files; existing app continues to work as before.

1. Create `tsconfig.base.json` with shared compiler options (matches the current `tsconfig.json`).
2. Replace root `package.json` with the workspace root version above (keeping current dependencies for the moment under a temporary `app` symlink).
3. Add `app` as a workspace at the same time as Phase 2 (deferred a few minutes — the rest of phase 1 is metadata).
4. Run `bun install` to confirm Bun rewrites `bun.lock` for workspace mode.

**Verification:** `bun install` succeeds. `bun pm ls` shows no errors.

### Phase 2 — Move customer app to `app/` (~1 hour)

**Goal:** all current files at root that belong to the customer app move under `app/`. The repo builds and tests pass.

1. Create `app/` directory.
2. Move into `app/`:
   - `src/`
   - `tests/` (only the parts that test the customer app — rights, banners, billing; keep `tests/rls/` at root for cross-app)
   - `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `sentry.*.ts`, `tsconfig.json`, `vitest.config.ts`
3. Move root `package.json`'s app dependencies (Next, React, Supabase, Sentry, etc.) into `app/package.json`.
4. Decide `tests/` split: cross-app integration tests (RLS isolation, admin tests once they exist) stay at repo root `tests/`; app-specific unit tests move under `app/tests/`. Update `vitest.config.ts` paths accordingly.
5. Update Vercel project (existing `consentshield`) — change Root Directory to `app`. Test with a preview deploy first.
6. `git mv` is preferred over `cp + rm` so git tracks renames.
7. Update `.wolf/anatomy.md` paths via OpenWolf rescan.

**Verification:**
- `bun --filter app run build` succeeds
- `bun --filter app run lint` zero warnings
- `bun --filter app run test` all pass
- Vercel preview deploy from the migration branch builds and renders the dashboard

### Phase 3 — Extract shared `packages/*` (~1.5 hours)

**Goal:** Three narrow packages that benefit both apps. The customer app then consumes them via `workspace:*`. Supabase clients, UI components, and app-specific lib code stay inside each app — see "Share narrowly, not broadly" below.

Order (each is one commit):

1. **`packages/shared-types`** — extract from `app/src/types/`. Types derived from the Postgres schema (consent event, artefact, billing plan, org, purpose definition). App-specific UI prop types stay in `app/src/types/`. Add `app` as consumer.
2. **`packages/compliance`** — extract from `app/src/lib/compliance/`. Deterministic functions over data (DPDP score, DEPA score, privacy-notice composition). Both apps need to render the same scores; sharing guarantees they agree. Add `app` as consumer.
3. **`packages/encryption`** — extract from `app/src/lib/encryption/`. Per-org key derivation. Add `app` as consumer. **Flag for review when ADR-0027 lands:** if admin-specific encryption needs emerge (admin secret wrapping), split into `packages/encryption-shared` + `admin/src/lib/encryption/admin-secrets.ts`.

#### Share narrowly, not broadly

The following do NOT become packages — each app keeps its own copy:

| Concern | Why | Where each app keeps it |
|---|---|---|
| Supabase server client | Customer uses `authenticated`/`anon` JWT + security-definer RPCs against `public.*`. Admin uses `cs_admin` connection + AAL2 + audit-logging RPC pattern against `admin.*`. Sharing risks leaking admin-specific logic into customer-reachable code (security boundary blur). | `app/src/lib/supabase/server.ts` and `admin/src/lib/supabase/server.ts` |
| Supabase browser client | Admin browser client checks `is_admin + AAL2` claims on every call; customer doesn't. | `app/src/lib/supabase/browser.ts` and `admin/src/lib/supabase/browser.ts` |
| UI components | Shadcn's design is copy-paste-into-codebase, not consume-as-library. Admin has different visual density, red admin-mode chrome, different layout shell. Shared "primitives" become a coordination point that slows both apps. Both apps run `bunx shadcn@latest add` against the same Tailwind tokens independently. | `app/src/components/` and `admin/src/components/` |
| App-specific lib code | `billing/`, `rights/`, etc. on the customer side; admin RPC wrappers and impersonation logic on the admin side. | `app/src/lib/...` and `admin/src/lib/...` |

The duplication this creates (Supabase client setup ~50 LOC × 2; shadcn primitive components ~100 LOC × 2 each as installed) is real but bounded and intentional. The independence buys: smaller blast radius, app-specific evolution without coordination cost, and a hard security wall between operator-privileged code and customer-reachable code.

For each package:

```jsonc
// packages/shared-types/package.json
{
  "name": "@consentshield/shared-types",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

```jsonc
// packages/shared-types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

```jsonc
// app/package.json (consumer)
{
  "dependencies": {
    "@consentshield/shared-types": "workspace:*"
  }
}
```

After each extraction commit, `bun install`, build, lint, test. If anything breaks, revert the single commit; the others are unaffected.

**Verification at end of Phase 3:**
- All 3 packages exist under `packages/*` with their own `package.json` + `tsconfig.json`
- `app` consumes all 3 via `workspace:*` references
- `bun --filter app run build` still passes
- `app/src/lib/{encryption,compliance}/` no longer exists (moved to packages); `app/src/lib/supabase/` IS retained (each app keeps its own Supabase client per the "Share narrowly" rule); `app/src/lib/{billing,rights}/` is unchanged (app-specific)

### Phase 4 — Admin app skeleton (~2 hours)

**Goal:** `admin/` exists as a Next.js app that serves a "Hello, admin" page behind the proxy gate. No real admin functionality yet — that's separate ADRs per panel.

1. `cd admin && bunx create-next-app@latest . --typescript --tailwind --app --no-import-alias --no-src-dir` — then move the generated structure into `admin/src/` to match the layout.
2. Add `admin/proxy.ts` per `consentshield-admin-platform.md` §3.2.
3. Add `admin/src/app/(auth)/login/page.tsx` — minimal Supabase Auth login UI with WebAuthn enforcement.
4. Add `admin/src/app/(operator)/page.tsx` — placeholder Operations Dashboard ("Hello, admin" + the current admin user's name).
5. Add `admin/package.json` with the same Next/React/Supabase versions as `app/package.json` (exact pinning). `workspace:*` dep on `@consentshield/shared-types` only; `compliance` and `encryption` join when admin needs them in ADR-0028+.
6. Add `admin/src/lib/supabase/{server,browser}.ts` — admin's OWN Supabase clients (cs_admin connection on the server, AAL2 + is_admin claim check on the browser). Do NOT consume `app/src/lib/supabase/*` — these are app-specific by design.
7. Run `bunx shadcn@latest init` inside `admin/` to set up its own shadcn config; add only what the skeleton needs (button, card). The admin app builds up its own component library independently of `app/src/components/`.
8. Add `admin/sentry.client.config.ts` and `admin/sentry.server.config.ts` pointing at a separate Sentry project.
9. Add `admin/eslint.config.mjs`, `admin/postcss.config.mjs`, `admin/tsconfig.json` (extends `../tsconfig.base.json`).

**Verification:**
- `bun --filter admin run dev` starts on `localhost:3001` (different port from app's 3000)
- Visiting `localhost:3001/` redirects to `/login` (proxy rejects un-auth)
- After signing in with a hardware key in dev, the operator-protected route renders

### Phase 5 — Vercel project split (~1 hour)

**Goal:** admin lives in a separate Vercel project on `admin.consentshield.in`.

1. Create new Vercel project `consentshield-admin` linked to the same GitHub repo.
2. Set Root Directory to `admin`.
3. Configure env vars per `consentshield-admin-platform.md` §11 (admin-specific). Use `vercel env pull` after to seed `admin/.env.local`.
4. Add domain `admin.consentshield.in` to the new project. DNS via Cloudflare (CNAME to `cname.vercel-dns.com`).
5. Configure "Ignored Build Step" so admin deploys only on changes to `admin/**`, `packages/**`, `worker/**` (the worker is shared infra), or `package.json` / `bun.lock`. Ignore changes that touch only `app/**`, `docs/**`, or `tests/rls/**` (rls test changes don't affect admin runtime).
6. Likewise update the existing `consentshield` project's Ignored Build Step so it skips admin-only changes.
7. Configure Cloudflare Access in front of `admin.consentshield.in` (free tier; GitHub-OAuth-restricted to the operator's GitHub account).
8. Configure separate Sentry project `consentshield-admin`.

**Verification:**
- `git push` to a feature branch produces a Vercel preview deploy for `consentshield-admin` only when `admin/**` changes
- Visiting the admin preview URL hits Cloudflare Access first, then Supabase Auth + AAL2, then the operator dashboard
- Customer app (existing `consentshield` project) preview also still works
- A `docs/**`-only change triggers neither build (Ignored Build Step honours both)

### Phase 6 — CI + isolation guards (~30 min)

**Goal:** programmatic checks that prevent accidental cross-contamination.

1. Add `scripts/check-env-isolation.ts` — fails if customer Vercel project lists any `ADMIN_*` env var, or if admin lists customer-only secrets it shouldn't have. Run as a pre-deploy step on both projects.
2. Add `scripts/check-no-admin-imports-in-app.ts` — greps `app/src/` for any import from `admin/` or `packages/admin-*`. Fails if found.
3. Add `scripts/check-no-customer-imports-in-admin.ts` — greps `admin/src/` for any import from `app/` or `packages/customer-*` (none exist today, but a future package might be customer-only).
4. Wire all three into a GitHub Actions workflow `monorepo-isolation.yml` that runs on every PR.

**Verification:**
- A PR that adds `import { adminFoo } from '@consentshield/admin-rpc'` to `app/src/` fails CI
- A PR that adds `ADMIN_HARDWARE_KEY_ENFORCED=true` env var via Vercel UI to the customer project fails the next deploy

---

## 4. Risk and rollback

The migration is fully reversible until Phase 5 (Vercel project split). Up to that point:

- Each phase is a small number of commits (~3–10).
- The repo builds at the end of every phase.
- Reverting a phase is `git revert` of its commits.

After Phase 5:

- Reverting requires also reverting the Vercel project change. Specifically, change the customer project's Root Directory back to `.` and delete the admin project. Both are 1-click in Vercel.
- DNS revert (remove `admin.consentshield.in` CNAME) is also 1-click.
- Cloudflare Access takedown is 1-click.

**No database changes** are part of this migration. The admin schema (defined in `consentshield-admin-schema.md`) lands in a separate ADR (ADR-0027 admin schema), which can happen before, during, or after this migration. The two are independent.

---

## 5. Coordination with the DEPA roadmap

The DEPA ADR roadmap (ADR-0019+) and this monorepo migration are independent in principle but interact slightly:

- DEPA tables and Edge Functions land in `supabase/` — unaffected by the monorepo restructure.
- DEPA-driven UI changes land in `app/src/app/`. After the migration, these are at `app/src/app/...` instead of `src/app/...`. The DEPA ADRs reference the customer-side ALIGNMENT doc (W1–W12 paths); those paths gain an `app/` prefix once the migration completes.
- Shared compliance score calculation (DPDP + DEPA) extracts to `packages/compliance/` in Phase 3. The DEPA score logic landing in ADR-0025 will live in this package from the start, simplifying admin-side score consumption later.

**Recommended sequencing if both streams are active:** Phases 1–3 of this migration first (workspace + extract packages), then DEPA ADRs proceed in `app/`, then Phases 4–6 of this migration alongside admin platform work. This keeps the merge surface small and lets DEPA ship faster.

**Recommended sequencing if DEPA is the priority:** Defer this entire migration until DEPA Phase A closes. The customer app continues at the repo root; admin platform work is queued behind DEPA.

The session-end project status memory should be updated when this sequencing is decided so future sessions don't re-litigate it.

---

## 6. Post-migration cleanup

After Phase 6, the repo root is much smaller. The following files at repo root can be removed once the migration is complete and verified:

- `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs` (root-level — moved into `app/`)
- `sentry.*.ts` (moved into `app/`)
- `vitest.config.ts` (moved into `app/`)
- `tsconfig.json` (replaced by `tsconfig.base.json`)
- `tsconfig.tsbuildinfo` (gitignored already; gets regenerated)
- `src/` (moved into `app/src/`)
- `tests/` legacy app-specific test files (moved into `app/tests/`)

Anything not enumerated above stays at the repo root: `worker/`, `supabase/`, `docs/`, `scripts/`, `test-sites/`, `.wolf/`, `.claude/`, `session-context/`, `package.json` (now workspace root), `bun.lock`, `CLAUDE.md`, `.gitignore`, `.prettierrc`, `tsconfig.base.json`, and the new `admin/` and `packages/` directories.

---

## 7. Reference

- [`consentshield-admin-platform.md`](./consentshield-admin-platform.md) — admin architecture (uses this layout)
- [`consentshield-admin-schema.md`](./consentshield-admin-schema.md) — admin database schema (independent of layout)
- [`../../architecture/consentshield-definitive-architecture.md`](../../architecture/consentshield-definitive-architecture.md) — customer architecture (unchanged by this migration except for path prefixes referenced in implementation)
- [Bun workspaces docs](https://bun.sh/docs/install/workspaces) (external)
- [Vercel monorepo support](https://vercel.com/docs/monorepos) (external)

---

*End of Monorepo Migration Plan.*
