# Pre-built deletion connectors

This directory houses the production deletion-orchestration connectors invoked by the fan-out pipeline when an artefact is revoked or an erasure request is processed. Each connector targets one downstream SaaS vendor's deletion or anonymisation API.

The connector catalogue below is the authoritative source for customer-facing surfaces. The whitepaper's Appendix D ("ConsentShield-Customer-Integration-Whitepaper-v2.md") and the site page at `docs/design/screen designs and ux/consentshield-site.html` MUST match this table. Any mismatch is a bug per the whitepaper-as-normative-spec rule (CC-F) and must be reconciled before merge.

## Status definitions

- **Shipping today** — OAuth flow, deletion API call, token refresh, error handling, and integration-test coverage against a real partner test account are all live in production and exercised by CI.
- **Q3 2026** — scoped in ADR-1007 Phase 1; delivery order within the quarter follows customer-pipeline signal.
- **Q4 2026** — scoped in ADR-1007 Phase 3; delivery order follows demand.

## Catalogue

| Service | Category | Deletion operation | Status | Owning sprint |
|---|---|---|---|---|
| Mailchimp | Email marketing | `DELETE /lists/{id}/members/{hash}` | Shipping today | ADR-0018, ADR-0039 |
| HubSpot | CRM | `DELETE /crm/v3/objects/contacts/{id}` | Shipping today | ADR-0018, ADR-0039 |
| CleverTap | Engagement | `POST /delete/profiles` | Q3 2026 | ADR-1007 Sprint 1.1 |
| Razorpay | Payments (PMLA anonymisation) | `POST /customers/{id}/anonymize` | Q3 2026 | ADR-1007 Sprint 1.2 |
| WebEngage | Engagement | `DELETE /users/{id}` | Q3 2026 | ADR-1007 Sprint 1.3 |
| MoEngage | Engagement | `DELETE /v1/customer/{id}` | Q3 2026 | ADR-1007 Sprint 1.3 |
| Intercom | Support | `POST /user_delete_requests` | Q3 2026 | ADR-1007 Sprint 1.4 |
| Freshdesk | Support | `PUT /api/v2/contacts/{id}` (anonymise) | Q3 2026 | ADR-1007 Sprint 1.4 |
| Shopify | E-commerce | `DELETE /customers/{id}` | Q3 2026 | ADR-1007 Sprint 1.5 |
| WooCommerce | E-commerce | `POST /customers/{id}/anonymize` | Q3 2026 | ADR-1007 Sprint 1.5 |
| Segment | CDP | `POST /regulations` (async) | Q3 2026 | ADR-1007 Sprint 1.6 |
| Zoho CRM | CRM | `DELETE /crm/v2/Contacts/{id}` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Freshworks CRM | CRM | `DELETE /contacts/{id}` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Zendesk | Support | `POST /api/v2/users/{id}/deletions` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Campaign Monitor | Email marketing | `DELETE /subscribers.json` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Mixpanel | Analytics | `POST /api/2.0/gdpr-requests` | Q4 2026 | ADR-1007 Sprint 3.1 |

Custom connectors for bank-specific partners (bancassurance, co-lending, bureau reporting) are delivered as part of the BFSI Enterprise engagement and are not tracked here.

## Adding a new connector

See ADR-1007 for the pattern. Every connector follows the same contract: OAuth (or vendor-appropriate auth), dashboard entry under `/dashboard/integrations`, deletion API call on revocation, retry + token refresh + rate-limit handling, integration test against a real partner sandbox, and a customer-facing setup guide under `docs/customer-docs/connectors/`.

When a Q3/Q4 row moves to Shipping today, update this file, the whitepaper Appendix D, and the site HTML in the same commit.
