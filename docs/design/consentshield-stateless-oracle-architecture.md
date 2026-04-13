# ConsentShield — The Stateless Oracle Model
## Why ConsentShield Should Hold No User Data

*Architecture decision · April 2026 · Follows from ABDM scope and data architecture analysis*

---

## The Core Question

Why should ConsentShield hold any user data at all?

Honestly — it probably shouldn't. There are two categories worth separating cleanly.

**Its own operational data** — org configurations, billing records, compliance manager accounts, banner settings. This is ConsentShield's business data about its customers, not personal data of data principals. Uncontroversial to hold. This is no different from what any SaaS holds about its paying users.

**Data principal data** — consent records, audit log entries, rights request history, any personal data that flows through for processing. This is the category the question is really about.

For the second category, the honest answer is: ConsentShield has no legitimate reason to be the system of record. The Data Fiduciary (the clinic, the business, the app) is legally required to retain this. ConsentShield's job is to generate it, validate it, and deliver it to whoever is legally responsible for it. That is a processing and delivery function, not a storage function.

---

## The Stateless Consent Oracle Model

Taken to its logical conclusion, ConsentShield becomes something closer to a payment gateway than a database. Stripe doesn't hold your product inventory — it processes transactions and hands you the record. ConsentShield shouldn't hold your compliance record — it should process consent events and hand you the record.

The architecture this implies:

```
Data principal interacts with customer's app
        │
        │  Consent event fires
        ▼
ConsentShield API
        │  Validates consent artefact (active index — see below)
        │  Generates audit entry
        │  Runs any processing (drug check, entity extract, etc.)
        │  in memory only
        │
        ├──► Streams audit entry to customer-owned storage
        │    (confirmed write before proceeding)
        │
        └──► Returns result + audit entry ID to customer's app
             Customer's app is the system of record.
             ConsentShield holds nothing after the transaction completes.
```

The customer's storage is the database. ConsentShield is the processing and orchestration layer that writes to it.

---

## Two Operational Necessities That Require Holding State

Full statelessness breaks in two specific places. Both have clean solutions that don't require accumulating personal data.

### 1. Consent Validation Latency

To answer "is this consent artefact valid right now?" in real-time without a round-trip to the customer's storage, ConsentShield needs a fast-access index. But that index only needs to contain: artefact ID, validity state, expiry timestamp. No personal data. No purpose content. Just a cryptographic reference with a TTL. When the artefact expires or is revoked, the index entry is deleted. This is an active-state cache, not a data store.

### 2. Audit Delivery Guarantee

If ConsentShield streams an audit entry to the customer's storage and the stream fails, you get a gap in a legally required compliance record. The fix is a write-ahead buffer — the event is held in ConsentShield's buffer, delivered to customer storage, and deleted from the buffer only after delivery is confirmed. The buffer retention is hours, not months. The canonical copy was always in customer storage. ConsentShield's copy existed only to guarantee delivery.

Neither of these requires ConsentShield to accumulate personal data. They are operational necessities with defined TTLs.

---

## What This Resolves

The current design document has a tension it doesn't fully resolve: ConsentShield is simultaneously trying to be a DPDP Data Processor (processing on behalf of the Fiduciary) and a data store (holding consent records and audit logs). Those two roles pull in opposite directions. A processor that accumulates a central record of everything it processes starts looking a lot like a Fiduciary.

The stateless oracle model dissolves that tension. ConsentShield is unambiguously a processor — it computes, it validates, it delivers. The Data Fiduciary holds the record because that is where legal retention obligation sits anyway.

The product pitch that results is cleaner than anything in the current design document:

> *"ConsentShield generates your compliance record and delivers it to you. We don't hold it. We can't be compelled to produce what we don't have. If we shut down tomorrow, your complete audit trail is already in your storage, readable without us."*

That is not a marketing claim. It is a description of how the system works. And it removes the single largest liability ConsentShield carries — being the entity a breach attacker or a Data Protection Board auditor comes to first.

---

## The One Honest Exception

There is one scenario where ConsentShield legitimately needs to hold user data: the default tier for non-technical customers who cannot provision their own storage. A single-doctor clinic cannot manage an S3 bucket and a KMS key rotation schedule.

For those customers, ConsentShield provisions the storage within its own infrastructure — but partitioned per clinic, encrypted with a per-clinic key that ConsentShield generates and delivers to the clinic once and does not retain. ConsentShield cannot read it after key delivery. The architecture is honest: ConsentShield is the storage provider but not the data controller. The clinic holds the key; ConsentShield holds an encrypted blob it cannot decrypt.

This is a pragmatic exception for adoption, not a contradiction of the principle. And it has a natural upgrade path — when the clinic acquires technical capacity, they bring their own bucket and ConsentShield's copy is deleted.

---

## The Revised Data Architecture Decision Table

| Decision | Previous design | Revised position |
|---|---|---|
| Who holds consent records | ConsentShield DB | Customer-owned storage; ConsentShield delivery buffer only |
| Who holds audit log | ConsentShield DB | Customer-owned storage; ConsentShield WAL buffer, deleted on confirmed delivery |
| Who holds health records | ConsentShield DB (wrong) | Nobody — in-memory transit only |
| Who holds active consent index | Not specified | ConsentShield — artefact ID + validity state only, TTL-based |
| Who holds org config | ConsentShield | ConsentShield — this is operational data, not user data |

The shift is that ConsentShield's database goes from being a compliance record store to being an operational state store. Those are fundamentally different things — one accumulates personal data indefinitely, the other holds only what is necessary to keep the processing layer running.

---

## Processing Modes

This principle is implemented through three modes that any app built on ConsentShield can select.

| Mode | What ConsentShield stores | Can ConsentShield read user data? | User data lives |
|---|---|---|---|
| **Standard** | Operational config + consent metadata | Yes, with access controls | ConsentShield DB (encrypted) |
| **Insulated** | Operational config + consent metadata | No — envelope encryption with customer-held KEK | Customer-owned storage, nightly export |
| **Zero-Storage** | Active consent index (TTL) + WAL buffer (hours) | No — data never persists | Customer-owned storage; ConsentShield holds nothing after confirmed delivery |

Zero-Storage mode is the natural target for any app handling health data, financial data, legal records, or mental health data. Insulated mode is the right target for most enterprise DPDP deployments. Standard mode is appropriate for early-stage companies that do not yet have the technical capacity to manage their own storage.

---

## The Regulatory Position This Creates

Under DPDP 2023, ConsentShield in Zero-Storage or Insulated mode is unambiguously a **Data Processor** — processing on behalf of the Fiduciary, never accumulating a record store that would trigger Fiduciary obligations. The ₹250 crore per violation exposure sits with the Fiduciary (the customer's business), not with ConsentShield, because ConsentShield never determined the purpose or means of processing.

The Data Processing Agreement operative clauses this architecture enables:

- ConsentShield processes personal data only for the purpose of providing the compliance and consent management service.
- ConsentShield exports all processed records to the customer's designated storage on a nightly basis (or immediately upon transaction completion in Zero-Storage mode).
- ConsentShield retains no data beyond what is necessary for service provision.
- ConsentShield's access to export storage is write-only. The customer holds all decryption keys.
- Upon termination, ConsentShield deletes all data within its own systems within 72 hours. The customer's export storage remains intact and fully under their control.

That DPA is substantively easier to sign than one where a software vendor holds sensitive personal data indefinitely. It is also more honest — because it accurately describes what ConsentShield does.

---

*Document prepared April 2026. Follows from ABDM Scope and Data Architecture analysis. Supersedes Section 8 (Technical Architecture) data architecture rules in the Master Design Document where they conflict.*
