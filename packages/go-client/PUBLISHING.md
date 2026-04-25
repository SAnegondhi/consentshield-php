# PUBLISHING — `github.com/SAnegondhi/consentshield-go`

Operator runbook for publishing the Go SDK. Go modules don't have a
central registry — distribution is via Git tags on the public
GitHub repo, served through the Go module proxy
(`proxy.golang.org`).

## Prerequisite — public Git repository

The module path baked into `go.mod` is
`github.com/SAnegondhi/consentshield-go`. The canonical Git repo lives
at that path, public, with the SDK at the repo root.

For now the SDK ships under the maintainer's personal GitHub account
(`SAnegondhi`); the bare `consentshield` org name was unavailable at
registration time. Once a vanity import path is set up
(`consentshield.in/go-client` via meta tags) the module path will
migrate behind the scenes without a v2 bump — until then,
`github.com/SAnegondhi/consentshield-go` is the canonical location.

## Per-release tag

The Go module proxy ingests semver tags of the form `vMAJOR.MINOR.PATCH`.

```sh
cd packages/go-client

# 1. pre-flight
go vet ./...
go test -count=1 -race -cover ./...
gofmt -l .              # must print nothing
go mod tidy

# 2. version bump
# Edit consentshield.go's `const Version = "X.Y.Z"`.

git add consentshield.go
git commit -m "chore(consentshield-go): bump to vX.Y.Z"

# 3. tag
git tag -a go/vX.Y.Z -m "consentshield-go vX.Y.Z"
# ... or, if the SDK is at the repo root, simply:
git tag -a vX.Y.Z -m "consentshield-go vX.Y.Z"

git push origin main
git push origin vX.Y.Z
```

The tag must match the on-disk module path:
- SDK at repo root → `vX.Y.Z`
- SDK at `<sub-dir>/` → `<sub-dir>/vX.Y.Z`

Mismatches cause `go get` to fail with "ambiguous version".

## Verify on the proxy

```sh
# Force-fetch through the proxy.
GOPROXY=https://proxy.golang.org GOFLAGS=-mod=mod \
  go list -m -versions github.com/SAnegondhi/consentshield-go

# Smoke install in a scratch project:
mkdir -p /tmp/cs-go-smoke && cd /tmp/cs-go-smoke
go mod init smoke
go get github.com/SAnegondhi/consentshield-go@vX.Y.Z
go build .
```

## v2 + breaking changes

A `v2` API requires the module path to gain a `/v2` suffix:
`github.com/SAnegondhi/consentshield-go/v2`. This is the official Go
module convention. New `v2.0.0+` tags will not be picked up by
existing `v1` callers — that's the point: we never break compatibility
in-place.

## Recovery from a bad tag

`git tag -d vX.Y.Z && git push --delete origin vX.Y.Z` removes the
tag from the repo BUT the module proxy may have cached it. The proxy
respects `GOPROXY=off` for known-bad versions; users should bump to
`vX.Y.(Z+1)` rather than waiting for the proxy to age out the bad
tag.

## Security checklist

- [ ] `go vet ./...` clean.
- [ ] `gofmt -l .` produces no output.
- [ ] Coverage gate ≥ 80% (`go test -cover` ≥ `0.800`).
- [ ] No replace directives in `go.mod`.
- [ ] Tag matches `consentshield.go`'s `Version` constant.
- [ ] Push tag from a clean working tree (no uncommitted changes).
