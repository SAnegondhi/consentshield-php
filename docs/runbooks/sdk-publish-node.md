# SDK publish runbook — Node.js (npm)

> **Source of truth:** [`packages/node-client/PUBLISHING.md`](../../packages/node-client/PUBLISHING.md). This file mirrors the canonical runbook so operators discovering `docs/runbooks/` can find it.
>
> Edits go in the source file, not here.

---

Open [`packages/node-client/PUBLISHING.md`](../../packages/node-client/PUBLISHING.md) for the full runbook (npm account + 2FA, `@consentshield` scope reservation, granular access token, `npm publish --access public` for scoped first-publish, smoke install, recovery from a bad release, leaked-token rotation, Bun git-install `dist/` gotcha).

## Quick reference

| Phase | Command |
|---|---|
| Pre-flight | `cd packages/node-client && bun run typecheck && bun run test && bun run build` |
| Tag | `git tag -a v1.0.0 -m "ConsentShield Node SDK 1.0.0" && git push origin v1.0.0` |
| Publish (first scoped) | `npm publish --access public` |
| Publish (subsequent) | `npm publish` |
| Smoke | `npm install @consentshield/node@1.0.0` |

**Coordinate published:** `@consentshield/node@1.0.0` (single package; not split — Tier 1 hand-rolled SDK ships as one artefact).

**Recovery posture:** `npm unpublish` works only within 72 hours and only if nothing depends on the version. Default recovery is `npm deprecate @consentshield/node@<bad>` + bump-and-republish.
