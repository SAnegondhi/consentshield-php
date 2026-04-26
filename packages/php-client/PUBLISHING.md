# Publishing the ConsentShield PHP SDK to Packagist

Operator runbook. Packagist auto-ingests new tags from the GitHub repo within ~5 minutes; no manual upload step. Once a version is published, you cannot delete it (you can only mark it abandoned or release a fix).

## One-time onboarding

1. **Create a Packagist account** at <https://packagist.org/login/> using the same GitHub identity that owns `github.com/SAnegondhi/consentshield-php`.
2. **Submit the package** at <https://packagist.org/packages/submit>:
   - Repository URL: `https://github.com/SAnegondhi/consentshield-php`.
   - Packagist parses `composer.json` and registers the namespace `consentshield/sdk`. (The generated raw client `consentshield/consentshield` is registered separately the same way.)
3. **Configure the GitHub webhook** to auto-update Packagist on push:
   - Packagist UI → "Configure" → "GitHub Service Hook" → follow instructions to add a webhook on the repo. After this, every push and tag triggers Packagist to re-parse the package within 60 s.
4. **Ensure stable email** is set on the Packagist account — security advisories land here.

## Pre-flight (every release)

```bash
cd packages/php-client/wrapper
composer install
vendor/bin/phpunit
```

All tests must pass. Coverage gate is documented as a future Coverlet-equivalent (Xdebug-driven) check for Phase 4.

The `version` field in `wrapper/composer.json` AND the git tag MUST match exactly.

## Cut a release tag

```bash
git tag -a v1.0.0 -m "ConsentShield PHP SDK 1.0.0"
git push origin v1.0.0
```

Within ~5 minutes the new version is searchable on Packagist and installable via `composer require consentshield/sdk:^1.0`.

## Smoke install

```bash
mkdir /tmp/cs-smoke && cd /tmp/cs-smoke
composer init -n --name=scratch/smoke
composer require consentshield/sdk:^1.0
php -r "require 'vendor/autoload.php'; \$c = ConsentShield\Sdk\ConsentShieldClient::create(getenv('CS')); var_dump(\$c->utility()->ping());"
```

## If a release is broken

**You cannot delete a Packagist release.** Recovery: bump to `1.0.1` and ship the fix. You can mark a single version abandoned via the Packagist UI (warns Composer users on install) or mark the entire package abandoned with a `replacement` field pointing at the new package name.

## v2+ release model

Composer follows Composer-Semver. Major-version breaks (e.g. dropping PHP 8.1 baseline) require a v2 ADR alongside the version bump. The `composer.json` `require.php` constraint pins the supported runtime range.
