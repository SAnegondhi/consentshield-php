---
globs: ["supabase/functions/**/*.ts"]
---

# Supabase Edge Function Rules

## Database credentials

- deliver-consent-events: uses SUPABASE_DELIVERY_ROLE_KEY (cs_delivery role)
- All other functions: use SUPABASE_ORCHESTRATOR_ROLE_KEY (cs_orchestrator role)
- NEVER use SUPABASE_SERVICE_ROLE_KEY in any Edge Function

## Delivery function (deliver-consent-events)

This function implements the core stateless oracle pipeline:
1. SELECT rows from buffer tables WHERE delivered_at IS NULL
2. Write each row to customer's R2/S3 storage (read export_configurations for credentials)
3. On confirmed write: UPDATE delivered_at = now() AND DELETE the row in the SAME transaction
4. On failed write: increment attempt_count, log delivery_error, schedule retry
5. After 10 failures: trigger alert via notification channels, hold row for manual review

The mark-and-delete MUST happen in a single transaction. Never mark delivered without immediately deleting. A row with delivered_at set but not deleted is a bug.

## Buffer cleanup

- sweep_delivered_buffers() is a safety net, not the primary mechanism
- The delivery function handles immediate deletion
- If the sweep finds rows, that means the delivery function's immediate delete failed — investigate

## Error handling

- Edge Functions that fail must not leave buffer rows in an inconsistent state
- If an Edge Function crashes mid-batch, the unprocessed rows remain with delivered_at = NULL and will be picked up on the next run
- Never swallow errors silently — log them, alert on them

## No personal data in logs

- Log event IDs, org IDs, timestamps, and error messages
- Never log request bodies, email addresses, consent payloads, or any PII
- Never log encryption keys or storage credentials
