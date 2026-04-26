# Regenerating the PHP SDK from the OpenAPI spec

The generated package under `generated/` is produced by OpenAPI Generator from the canonical spec served at `https://api.consentshield.in/openapi.yaml`. The `wrapper/` package is hand-rolled and never regenerated.

## Pinned tooling

- `openapitools/openapi-generator-cli:v7.10.0` (Docker; exact-pinned per Rule 17 in the upstream consentshield CLAUDE.md)
- Config: `openapi-config.json` (this directory)

## Regenerate

```sh
mkdir -p .regen-tmp
curl -fsSL https://api.consentshield.in/openapi.yaml -o .regen-tmp/openapi.yaml
docker run --rm \
  -v "$(pwd)":/work \
  openapitools/openapi-generator-cli:v7.10.0 generate \
    -g php \
    -i /work/.regen-tmp/openapi.yaml \
    -c /work/openapi-config.json \
    -o /work/generated
rm -rf .regen-tmp
```

## Drift check

In CI, regenerate to a temp dir and `diff -r generated/ .regen-tmp/generated/`. Fail on non-empty diff. The wrapper's tests are runtime contract; the generator drift check is structural contract.

## Bumping the generator version

Bumping `openapi-generator-cli` is a breaking change for downstream consumers — output churn is the whole point of pinning. Bump only with an ADR amendment in the upstream consentshield repo (ADR-1028 §Architecture Changes) and a coordinated patch release.
