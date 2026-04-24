# BYOS on Cloudflare R2

(c) 2026 Sudhindra Anegondhi — ConsentShield customer documentation.

This guide walks you through provisioning a Cloudflare R2 bucket and a write-only S3-compatible credential for use with ConsentShield in **Insulated** or **Zero-Storage** mode.

## Who this is for

- You already run workloads on Cloudflare and prefer R2 over AWS S3 for egress-cost reasons.
- You have a Cloudflare account and can create R2 buckets + R2 API Tokens.
- You have `org_admin` (or `account_owner`) on your ConsentShield org.

## Important — R2's permission model vs. ConsentShield's scope-down probe

ConsentShield's validator runs a 5-check probe: `PutObject` must succeed; `HeadObject`, `GetObject`, `ListObjectsV2`, `DeleteObject` must each return 4xx. The validator rejects any credential that is over-scoped.

**R2's standard permission scopes are coarser than AWS IAM.** As of 2026-04, the out-of-the-box R2 API Token scopes are:

| Scope | What it grants | Passes scope-down? |
|---|---|---|
| Admin Read & Write | Everything | No (over-scoped) |
| Admin Read | Read-only, all buckets | No (under-scoped on write) |
| Object Read & Write | R/W on selected buckets | No (over-scoped on read) |
| Object Read Only | Read-only on selected buckets | No (under-scoped on write) |

To pass the scope-down probe you need R2's **custom permissions** (also called "fine-grained token permissions"), which let you build an S3-compatible policy with only `s3:PutObject`. If custom permissions aren't available on your plan, you have two options:

1. **Use AWS S3 instead** (see `byos-aws-s3.md`). AWS IAM grants the fine-grained scope today.
2. **Pair R2 with a Cloudflare Worker proxy** that re-signs PUTs and denies everything else. Non-trivial; document TBD.

The rest of this guide assumes custom permissions are available.

## Step 1 — Create the R2 bucket

Dashboard: **R2 → Create bucket**. Pick a location hint close to your users. Do not make the bucket public.

Via Wrangler:

```bash
npx wrangler r2 bucket create your-consentshield-compliance \
  --location apac
```

## Step 2 — Create a write-only R2 API Token

Dashboard: **R2 → Manage R2 API Tokens → Create API Token**.

1. **Permissions**: select **Custom Permissions**.
2. **Resources**: select your bucket only — *not* `Apply to all buckets`.
3. **Allowed actions**: select only `PutObject`. Leave `GetObject`, `ListBucket`, `DeleteObject`, `HeadBucket`, `HeadObject` **unchecked**.
4. **TTL**: at most 90 days. Rotate proactively.

Click **Create**. The dialog shows:

- **Access Key ID** — equivalent to AWS IAM access key id.
- **Secret Access Key** — equivalent to AWS secret.
- **Endpoint** — `https://<account-id>.r2.cloudflarestorage.com`.

Copy all three. The secret is shown only once.

### What the R2 permissions map to

R2's API-compatibility table (https://developers.cloudflare.com/r2/api/s3/api/) maps custom permissions to S3 actions. For ConsentShield you want exactly:

```
ALLOW PutObject
DENY GetObject, HeadObject, ListBucket, ListObjectsV2, DeleteObject
```

## Step 3 — Paste into ConsentShield

1. Log in to your ConsentShield dashboard.
2. Go to **Settings → Storage**.
3. Click **Switch to BYOS**.
4. Pick **Cloudflare R2** as the provider.
5. Fill in:
   - **Bucket**: `your-consentshield-compliance`
   - **Region**: `auto`
   - **Endpoint URL**: `https://<account-id>.r2.cloudflarestorage.com` (from step 2).
   - **Access key ID**: from step 2.
   - **Secret access key**: from step 2.
6. Complete the robot-check and click **Validate credentials**.

A correctly-scoped R2 custom-permission token produces:

```
✓ PutObject      — must succeed          HTTP 200  ok
✓ HeadObject     — must fail (403)       HTTP 403  ok
✓ GetObject      — must fail (403)       HTTP 403  ok
✓ ListObjectsV2  — must fail (403)       HTTP 403  ok
✓ DeleteObject   — must fail (403)       HTTP 403  ok
```

If you see `over-scoped` on HEAD, GET, LIST, or DELETE, your token has more permissions than required. Revoke it in the R2 dashboard, create a new one with stricter custom permissions, and retry.

## Step 4 — The orphan probe object

The validator PUTs `cs-probe-<hex>.txt` to prove the credential works. Because your credential cannot delete objects, the probe file stays in your bucket. R2 supports S3-compatible lifecycle rules; add one that expires `cs-probe-*` after 1 day:

```bash
cat > lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "ExpireConsentShieldProbes",
      "Status": "Enabled",
      "Filter": { "Prefix": "cs-probe-" },
      "Expiration": { "Days": 1 }
    }
  ]
}
EOF

aws --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
    s3api put-bucket-lifecycle-configuration \
    --bucket your-consentshield-compliance \
    --lifecycle-configuration file://lifecycle.json
```

Lifecycle rules are applied at object-expiration cadence (daily), not in real time.

## Step 5 — Start the migration

Once validation succeeds, the dashboard offers two cut-over modes:

- **Forward-only cut-over.** Completes in seconds. Future consent events + audit exports write to your R2 bucket. Existing records stay in the ConsentShield-managed bucket for 30 days, then are deleted.
- **Copy existing records.** Streams every object to your R2 bucket (~2× bandwidth), then cuts over. Takes minutes to hours.

## Credential rotation

Rotate the R2 API Token every 90 days.

1. Create a new R2 API Token (steps 1–3 above, new token).
2. Paste the new `Access Key ID` + `Secret` into **Settings → Storage → Update credentials**.
3. Wait 5 minutes and confirm `worker_errors` is clean.
4. Revoke the old token in the R2 dashboard.

## R2 ⇄ S3 API compatibility notes

R2 implements the S3 API but with a few divergences. Relevant ones for this flow:

- **Region is always `auto`.** R2 ignores the `region` field in sigv4; any string works, but `auto` is the documented norm.
- **Endpoint is account-scoped, not region-scoped.** All R2 buckets across all regions for one account share `https://<account-id>.r2.cloudflarestorage.com`.
- **Lifecycle rules** work via the S3 API (`PutBucketLifecycleConfiguration`).
- **Bucket versioning** is R2's "Event Notifications + Object Lifecycle", not an S3-style `PutBucketVersioning`. Immutability should be enforced via your Cloudflare zero-trust tooling or by relying on ConsentShield's scope-down (ConsentShield cannot delete, so records survive by default).
- **Object-level ACLs** are not supported. R2 uses the bucket's visibility (public vs. private) plus custom access via Workers.

If you run into compatibility issues that aren't listed here, try the canonical AWS CLI against your R2 endpoint — if AWS CLI fails the same way ConsentShield does, the gap is on R2's side and should be filed as a Cloudflare support ticket.

## Troubleshooting

**All five checks show `error` with `ECONNREFUSED`.** Your endpoint URL is wrong. Double-check the account-id prefix; R2 endpoints never contain a region.

**`PutObject — under-scoped, HTTP 401`.** The R2 API Token doesn't have `PutObject` on the bucket you selected. Recreate the token with custom permissions, confirming `PutObject` is checked and the bucket is in scope.

**`PutObject — succeeded; HeadObject — over-scoped`.** You used R2's standard "Object Read & Write" scope rather than custom permissions. Recreate the token with custom permissions.

**Validator succeeds on `Object Read & Write` unexpectedly.** R2 may have updated its permission model. Open a ConsentShield support ticket and include the R2 token's displayed permissions — we can loosen the probe where it's safe.
