# BYOS on AWS S3

(c) 2026 Sudhindra Anegondhi — ConsentShield customer documentation.

This guide walks you through provisioning an AWS S3 bucket and a write-only IAM credential for use with ConsentShield in **Insulated** or **Zero-Storage** mode.

## Who this is for

- You're on ConsentShield **Growth tier or above**, or you're a healthcare customer, or your procurement team requires that compliance records never leave your AWS account.
- You have an existing AWS account and can create S3 buckets, IAM policies, and IAM access keys.
- You have `org_admin` (or `account_owner`) on your ConsentShield org.

## What ConsentShield needs

Exactly one capability: **`s3:PutObject`** on your chosen bucket. Nothing else. ConsentShield **must not** be able to `GetObject`, `ListBucket`, or `DeleteObject` on your bucket. The write-only constraint is the structural guarantee that a compromised ConsentShield environment cannot exfiltrate or tamper with your compliance records.

The `/dashboard/settings/storage` validator runs a 5-check probe against the credential you paste and **rejects** any credential that is over-scoped. Under-scoped credentials (missing write) are also rejected.

## Step 1 — Create the S3 bucket

Pick a region close to your users and your ConsentShield org. Block all public access. Enable object versioning so accidental key reuse doesn't overwrite an older record.

```bash
aws s3api create-bucket \
  --bucket your-consentshield-compliance \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

aws s3api put-public-access-block \
  --bucket your-consentshield-compliance \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning \
  --bucket your-consentshield-compliance \
  --versioning-configuration Status=Enabled
```

## Step 2 — Create the IAM policy

Create an IAM policy with a single `s3:PutObject` statement. Do not grant any other action; the ConsentShield validator will reject the credential otherwise.

Save the following JSON as `consentshield-write-only.json`, replacing `YOUR-BUCKET-NAME`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsentShieldWriteOnly",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

Create it:

```bash
aws iam create-policy \
  --policy-name ConsentShieldWriteOnly \
  --policy-document file://consentshield-write-only.json
```

Record the returned `PolicyArn` — you need it in step 3.

### Why no other actions?

| Action we deliberately omit | Why |
|---|---|
| `s3:GetObject` | If ConsentShield can read your records, a compromised environment can exfiltrate them. |
| `s3:ListBucket` | Listing lets an attacker enumerate object keys without individually guessing them. |
| `s3:DeleteObject` | ConsentShield should never rewrite the audit trail. Immutability is load-bearing for regulatory disclosures. |
| `s3:HeadObject` | Folds into `s3:GetObject` on AWS IAM; same reason. |

## Step 3 — Create the IAM user + access key

ConsentShield authenticates via AWS IAM access key + secret. Create a dedicated IAM user (do **not** reuse a human's access key).

```bash
aws iam create-user --user-name consentshield-writer

aws iam attach-user-policy \
  --user-name consentshield-writer \
  --policy-arn arn:aws:iam::ACCOUNT-ID:policy/ConsentShieldWriteOnly

aws iam create-access-key --user-name consentshield-writer
```

The last command prints `AccessKeyId` and `SecretAccessKey`. Copy both now — the secret is shown only once.

## Step 4 — Paste into ConsentShield

1. Log in to your ConsentShield dashboard.
2. Go to **Settings → Storage**.
3. Click **Switch to BYOS**.
4. Pick **AWS S3** as the provider.
5. Fill in:
   - **Bucket**: `your-consentshield-compliance`
   - **Region**: the region you picked in step 1 (e.g., `ap-south-1`).
   - **Endpoint URL**: `https://s3.ap-south-1.amazonaws.com` (replace the region).
   - **Access key ID**: from step 3.
   - **Secret access key**: from step 3.
6. Complete the robot-check and click **Validate credentials**.

The validator runs five checks. For a correctly-scoped credential you'll see:

```
✓ PutObject      — must succeed          HTTP 200  ok
✓ HeadObject     — must fail (403)       HTTP 403  ok
✓ GetObject      — must fail (403)       HTTP 403  ok
✓ ListObjectsV2  — must fail (403)       HTTP 403  ok
✓ DeleteObject   — must fail (403)       HTTP 403  ok
```

If any row shows `over-scoped` or `under-scoped`, rotate the credential with the correct scope and retry.

## Step 5 — The orphan probe object

The validator PUTs a file named `cs-probe-<hex>.txt` to prove the credential works. Because your credential cannot `DeleteObject`, that file **stays in your bucket**. This is intentional — if ConsentShield could delete the probe, it could also delete your compliance records.

Add an S3 lifecycle rule that expires `cs-probe-*` objects after 1 day:

```json
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
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket your-consentshield-compliance \
  --lifecycle-configuration file://lifecycle.json
```

## Step 6 — Start the migration

Once validation succeeds, the dashboard offers two cut-over modes:

- **Forward-only cut-over.** Completes in seconds. Future consent events and audit exports write to your bucket. Existing records stay in the ConsentShield-managed bucket for 30 days, then are deleted.
- **Copy existing records.** Streams every object from the ConsentShield-managed bucket to your new bucket. Takes minutes to hours depending on object count. Resumable across failures. Uses roughly 2× bandwidth.

Pick based on whether you need historical records in your own bucket from day one. If you already export audit packages regularly, forward-only is usually enough.

## Credential rotation

Rotate the access key at least every 90 days. AWS recommends 180-day ceilings; shorter is better.

1. Create a second access key for `consentshield-writer` (AWS IAM allows two active keys per user).
2. Paste the new key into **Settings → Storage → Update credentials**.
3. Wait 5 minutes and confirm `worker_errors` is not reporting PUT failures.
4. Delete the old access key in AWS IAM.

Never edit the IAM policy to add more actions "for debugging" — the next validator run will catch the drift and fail the credential. Always rotate the key instead.

## Troubleshooting

**`PutObject — under-scoped, HTTP 403`.** Your IAM user doesn't have `s3:PutObject` on the bucket. Check the policy is attached to the user (not just created) and that the `Resource` ARN exactly matches your bucket name, with the `/*` suffix.

**`HeadObject — over-scoped, HTTP 200`.** You attached an admin policy or `AmazonS3FullAccess`. Detach those and attach only the `ConsentShieldWriteOnly` policy.

**`PutObject — under-scoped, HTTP 400`.** The endpoint URL is wrong for the region. S3 endpoints look like `https://s3.<region>.amazonaws.com`.

**`PutObject — error, "certificate"`.** Your VPC endpoint or corporate MITM proxy is rewriting TLS. Either use the public S3 endpoint or whitelist Cloudflare's outbound IPs in your firewall.

**`ListObjectsV2 — over-scoped, HTTP 200`.** A bucket policy is granting `s3:ListBucket` to everyone. Either remove the bucket policy, or scope it to specific principals that do not include the ConsentShield IAM user.

**Validator hangs / times out.** Your bucket region's S3 endpoint is unreachable from Vercel. Open a ConsentShield support ticket so we can check outbound connectivity from our region.

## What happens next

- New consent events land in your bucket at `<path_prefix>consent_events/<YYYY>/<MM>/<DD>/<event_fingerprint>.json`.
- Audit exports land at `<path_prefix>audit_exports/<YYYY>/<MM>/<DD>/<export_id>.tar.gz`.
- The ConsentShield dashboard continues to show operational metrics (counts, latencies, probe runs). It no longer holds the record content.
- Your bucket is now the compliance record of truth. Back it up as you would any other regulatory archive.
