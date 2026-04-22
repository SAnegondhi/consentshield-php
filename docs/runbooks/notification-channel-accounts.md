# Notification channel account setup — Slack / Teams / Discord / PagerDuty

**Scope:** ADR-1005 Phase 6 prerequisite. Walk-through for setting up the *test* accounts each adapter needs before the Sprint 6.2 / 6.3 implementation can actually send.

All four services have free tiers that cover what ConsentShield needs in dev. Real customer deployments use the customer's own workspace / tenant / org — we never relay customer alerts through our test accounts. What follows is ONLY for the dev + E2E test harness.

---

## 1. Slack (incoming webhook)

**Cost:** Free
**Time:** ~10 min

**Steps:**
1. Visit <https://slack.com/get-started#/createnew> and create a new workspace. Name suggestion: `ConsentShield Dev`.
2. Once the workspace is live, visit <https://api.slack.com/apps> → **Create New App** → **From scratch** → pick the workspace you just created. App name suggestion: `ConsentShield Notifications Dev`.
3. In the app settings left sidebar → **Incoming Webhooks** → toggle **Activate Incoming Webhooks** on.
4. Scroll to **Webhook URLs for Your Workspace** → **Add New Webhook to Workspace** → pick a channel (create `#consentshield-alerts` first if needed).
5. Copy the webhook URL. It looks like:
   ```
   https://hooks.slack.com/services/T000…/B000…/xxxxxxxxxxxxxxx
   ```
6. Store it in `.secrets`:
   ```
   SLACK_TEST_WEBHOOK_URL=https://hooks.slack.com/services/T000…/B000…/xxxx
   ```
   Mode-600 gitignored file.
7. Sanity-check from CLI:
   ```
   curl -X POST -H 'Content-Type: application/json' \
     --data '{"text":"ConsentShield dev harness: hello from Slack webhook"}' \
     "$SLACK_TEST_WEBHOOK_URL"
   ```
   Expect `ok` in the response and a message in `#consentshield-alerts`.

**Per-customer pattern (ADR-1005 Sprint 6.4):** customers will paste *their own* webhook URL into `notification_channels.config.slack.webhook_url` per org via the admin surface we haven't yet built. The test webhook above never handles customer data.

---

## 2. Microsoft Teams (incoming webhook / Adaptive Card)

**Cost:** Free (requires a Microsoft work/school account — a personal `@outlook.com` account works for the dev tenant)
**Time:** ~15 min

**Steps:**
1. Visit <https://www.microsoft.com/en-in/microsoft-teams/free> → **Sign up for free**.
2. Create a tenant. You'll get a `.onmicrosoft.com` domain. Name suggestion: `ConsentShield Dev`.
3. In Teams, **Teams** tab → **Join or create a team** → **Create team** → private. Name: `CS Dev`.
4. Create a channel `alerts-test` inside that team.
5. Right-click the channel → **Manage channel** → **Settings** → **Connectors**. If you don't see Connectors, your tenant is on the new Workflows-only path — see the Workflows fallback below.
6. **Classic webhook path:** In Connectors, find **Incoming Webhook** → **Add**. Name: `ConsentShield test`. Upload an icon (optional). Copy the webhook URL. Looks like:
   ```
   https://<tenant>.webhook.office.com/webhookb2/…@…/IncomingWebhook/…/…
   ```
7. **Workflows fallback:** If Microsoft has deprecated Incoming Webhooks in your tenant (they're rolling this out), go to <https://make.powerautomate.com/> → **Create** → **Instant cloud flow** → trigger **When a Teams webhook request is received** → action **Post card in a chat or channel** → target your channel. The trigger URL is the webhook URL. Adaptive Card payload shape matches the classic webhook.
8. Store in `.secrets`:
   ```
   TEAMS_TEST_WEBHOOK_URL=https://<tenant>.webhook.office.com/webhookb2/…
   ```
9. Sanity-check:
   ```
   curl -X POST -H 'Content-Type: application/json' \
     --data '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","$schema":"http://adaptivecards.io/schemas/adaptive-card.json","version":"1.4","body":[{"type":"TextBlock","text":"ConsentShield dev harness: hello from Teams","wrap":true,"weight":"bolder"}]}}]}' \
     "$TEAMS_TEST_WEBHOOK_URL"
   ```

**Gotcha:** Microsoft keeps sunsetting Teams webhook endpoints (Office 365 connectors are "retiring"; new path is Power Automate). If the classic path doesn't appear, use Power Automate; payload shape is identical.

---

## 3. Discord (webhook)

**Cost:** Free
**Time:** ~5 min

**Steps:**
1. Sign in to <https://discord.com/login> (or sign up). Create a personal server: **+** in the sidebar → **Create My Own** → For me and my friends. Name: `ConsentShield Dev`.
2. Create a text channel `#alerts-test`.
3. Right-click the channel → **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**. Name: `ConsentShield test`. Copy the webhook URL. Looks like:
   ```
   https://discord.com/api/webhooks/1234567890/abcdefghijklmnop
   ```
4. Store in `.secrets`:
   ```
   DISCORD_TEST_WEBHOOK_URL=https://discord.com/api/webhooks/…/…
   ```
5. Sanity-check:
   ```
   curl -X POST -H 'Content-Type: application/json' \
     --data '{"content":"ConsentShield dev harness: hello from Discord webhook"}' \
     "$DISCORD_TEST_WEBHOOK_URL"
   ```

---

## 4. PagerDuty (Events API v2)

**Cost:** Free tier covers 5 users + unlimited integrations.
**Time:** ~15 min

**Steps:**
1. <https://www.pagerduty.com/sign-up/> → Free tier → company name `ConsentShield Dev`.
2. After onboarding, **Services** → **New Service**:
   - Name: `ConsentShield Pipeline`
   - Escalation Policy: default (yourself on-call)
   - Integrations: **Events API v2** (pick "Use our API directly" if asked)
3. Copy the **Integration Key** (routing key). 32-char hex.
4. Store in `.secrets`:
   ```
   PAGERDUTY_TEST_ROUTING_KEY=abcdef0123456789abcdef0123456789
   ```
5. Sanity-check:
   ```
   curl -X POST "https://events.pagerduty.com/v2/enqueue" \
     -H 'Content-Type: application/json' \
     --data "{
       \"routing_key\": \"$PAGERDUTY_TEST_ROUTING_KEY\",
       \"event_action\": \"trigger\",
       \"dedup_key\": \"cs-dev-hello-$(date +%s)\",
       \"payload\": {
         \"summary\": \"ConsentShield dev harness: hello\",
         \"source\": \"consentshield.dev\",
         \"severity\": \"info\"
       }
     }"
   ```
   Expect HTTP 202 and a new incident in the PagerDuty dashboard.

---

## Once all four are provisioned

1. Update the `admin.ops_readiness_flags` row for **ADR-1005 S3.2 PagerDuty** → `status=resolved` via the `/admin/(operator)/readiness` UI.
2. Sprint 6.1 (adapter interface) is already safe to write with mock adapters — these keys only become load-bearing in Sprint 6.2 / 6.3 live-delivery tests.
3. When Sprint 6.2 / 6.3 land, the integration-test env vars are: `SLACK_TEST_WEBHOOK_URL`, `TEAMS_TEST_WEBHOOK_URL`, `DISCORD_TEST_WEBHOOK_URL`, `PAGERDUTY_TEST_ROUTING_KEY`. Tests skip gracefully when any are unset (same pattern as `SUPABASE_CS_WORKER_DATABASE_URL`).
4. **Do not** commit the webhook URLs or the routing key. `.secrets` is already gitignored; double-check before `git add`.

---

## Security notes

- **Slack + Teams + Discord webhooks are unauthenticated bearer URLs.** Anyone who captures the URL can post to your channel. Rotate the webhook if you suspect leakage. For prod use, rotation is a customer responsibility; we never store customer webhook URLs in plaintext (ADR-1005 Sprint 6.4 encrypts them with the per-org key derivation — Rule 11).
- **PagerDuty routing keys are long-lived** until rotated in the PagerDuty UI. Treat like any bearer secret.
- **None of these channels are appropriate for PII.** The adapter payload specification (Sprint 6.1) deliberately strips identifiers and emits only counts / IDs — same defensive shape ADR-0001 Rule 18 enforces for Sentry.
