# Publishing the ConsentShield Node SDK to npm

Operator runbook. npm package versions are immutable: once `1.0.0` is published, you cannot overwrite it (you have a ~72-hour `npm unpublish` window for pre-prod accidents only — never rely on it for production).

## One-time onboarding

1. **Create an npm account** at <https://www.npmjs.com/signup> using the GitHub identity that owns `github.com/SAnegondhi/consentshield-node`. Verify the email.
2. **Enable 2FA** with authenticator app at <https://www.npmjs.com/settings/~/profile> → "Two-factor authentication" → "Auth & writes" mode (required for scoped publishes).
3. **Reserve the `@consentshield` org/scope** at <https://www.npmjs.com/org/create>:
   - Org name: `consentshield`
   - Plan: Free (public packages only).
   - Add yourself as the sole owner.
4. **Generate a granular access token** at <https://www.npmjs.com/settings/~/tokens> → "Generate New Token" → **Granular**:
   - Token name: `consentshield-publish`
   - Expiry: 90 days. Set a calendar reminder to rotate.
   - Permissions: **Read and write** on packages/scopes `@consentshield/*`. No org admin, no other scopes.
   - Save the token to a password manager. Do NOT commit it.

## Pre-flight (every release)

```bash
cd packages/node-client
bun install
bun run lint        # if a lint script exists
bun run typecheck
bun run test
bun run build       # produces dist/index.{mjs,cjs,d.ts,d.cts}
```

`prepublishOnly` already chains `build && typecheck && test` (declared in `package.json`), so `npm publish` triggers them automatically. The pre-flight above is the manual smoke before tagging.

The `version` in `package.json` MUST match the git tag exactly.

## Cut a release tag

```bash
git tag -a v1.0.0 -m "ConsentShield Node SDK 1.0.0"
git push origin v1.0.0
```

## Publish

```bash
cd packages/node-client
export NPM_TOKEN=npm_xxxxxxxxxxxx     # the granular token
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
npm publish --access public            # @consentshield/* is a scoped pkg
rm .npmrc                              # do NOT commit
```

`--access public` is mandatory the first time a scoped package is published (npm defaults scoped packages to `restricted` which would lock the SDK behind paid Teams). Subsequent publishes inherit the access setting from the registry.

The published artefact contains: `dist/`, `README.md`, `LICENSE`, `NOTICE` (per the `files` field in `package.json`). Source is intentionally NOT shipped — consumers install the compiled bundle.

## Smoke install

```bash
mkdir /tmp/cs-smoke && cd /tmp/cs-smoke
npm init -y
npm install @consentshield/node@1.0.0
node --eval "import('@consentshield/node').then(m => console.log(Object.keys(m)))"
```

You should see the SDK's exported symbols (`ConsentShieldClient`, error classes, types) printed.

## Verify on npmjs.com

- <https://www.npmjs.com/package/@consentshield/node> — should show `1.0.0`, your README, weekly download counter at 0.
- "Files" tab — should list `dist/`, `LICENSE`, `NOTICE`, `README.md`. **No `src/`, no `tests/`, no `node_modules/`.**

## If a release is broken

**You cannot rely on `npm unpublish`.** It works only within 72 hours of publish, only if no other package depends on the version. The canonical recovery path is to bump (`1.0.1`) and ship the fix.

For a critical security issue published in error:

1. Within 72 hours: `npm unpublish @consentshield/node@1.0.0` (last resort; breaks any consumer who already installed).
2. Always: bump the patch version, fix, re-publish. Add a deprecation notice to the bad version: `npm deprecate @consentshield/node@1.0.0 "Critical bug; use 1.0.1+"`. The deprecation warning shows up on every install.

## Recovery from a leaked token

1. Revoke the token at <https://www.npmjs.com/settings/~/tokens>.
2. Generate a new granular token.
3. If the leak post-dated a publish, audit npm's package history at the package URL → "Versions" tab; rotate the SDK API key in your test fixtures if the test fixture was leaked.

## v2+ release model

Package name stays `@consentshield/node`. The `version` field bumps. Major-version breaks (e.g. dropping Node 18 baseline, switching from `fetch` to `undici` API) require a v2 ADR alongside the version bump.

## Bun + git-install gotcha

`bun add github:SAnegondhi/consentshield-node#v1.0.0` installs from the source tree, NOT the published tarball. Because `dist/` is gitignored on the public repo, the git-install resolves but the package is unimportable. Two workarounds, neither blocking now that npm publish is the canonical path:

1. Commit `dist/` to the public repo at the release tag (one-time per release; gitignore exception).
2. Add a `prepare` script that runs `bun run build` on git install (Bun and npm both honour `prepare` for git deps).

The npm-published tarball always contains `dist/`, so the standard `npm install @consentshield/node` path works regardless.
