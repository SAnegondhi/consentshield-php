# ConsentShield — v2.0 Whitepaper Closure Plan

(c) 2026 Sudhindra Anegondhi · a.d.sudhindra@gmail.com

*Plan date: 2026-04-19*
*Source of truth: `docs/design/ConsentShield-Whitepaper-V2-Gaps-Combined.md`*
*Execution artefacts: ADR-1001 through ADR-1008 (each ADR is one phase of this plan)*

---

## Purpose

This plan sequences the 49 open gaps in the combined gap document into eight executable phases, each scoped to a single ADR (ADR-1001 through ADR-1008). Every ADR owns one or more sprints; every sprint ends with a test, a commit, and an ADR + changelog update before the next sprint begins — per the project's ADR-driven workflow (CLAUDE.md → "Development workflow").

## Execution rule (recap)

Per CLAUDE.md:

- No code without an ADR.
- Every sprint delivers a testable checkpoint. Testing occurs before the next sprint starts.
- After each sprint: update the ADR sprint status + test results, update the relevant changelog, commit with message `feat(ADR-NNNN): phase X sprint Y — <short title>`.
- After each phase: review, mark ADR Completed if all sprints done, update ADR-index.

## Phase → ADR map

| Phase | ADR | Title | Gaps in scope | Critical-path weeks | Compliance obligations unblocked |
|---|---|---|---|---|---|
| 1 | ADR-1001 | Truth-in-marketing + Public API foundation | G-001, G-004, G-036 | Weeks 1–2 | Precondition for all server-to-server (O1–O5, O9) |
| 2 | ADR-1002 | DPDP §6 runtime enforcement surface | G-037, G-038, G-039, G-040 | Weeks 3–5 | O1 (multi-channel), O2, O3, O4 |
| 3 | ADR-1003 | Processor posture + Healthcare category unlock | G-041, G-006, G-005, G-042, G-046 | Weeks 5–8 | O7, O1 (healthcare) |
| 4 | ADR-1004 | Statutory retention + material-change + silent-failure | G-007, G-008, G-012, G-048, G-034 | Weeks 8–12 | O5, O6, O8 |
| 5 | ADR-1005 | Operations maturity | G-011, G-035, G-013, G-014, G-015, G-049, G-043 | Weeks 10–14 | O4 (multi-channel), delivery, O8 (non-email alerts) |
| 6 | ADR-1006 | Developer experience + OpenAPI | G-002, G-003, G-024, G-045 | Weeks 14–17 | O2 (safety net), O9 (trust) |
| 7 | ADR-1007 | Connector catalogue expansion + ecosystem plugins | G-016, G-017, G-018, G-019, G-020, G-021, G-022, G-023, G-030 | Weeks 17–26 | O5 depth, O1 reach |
| 8 | ADR-1008 | Scale + audit polish + P3 hardening | G-009, G-010, G-026, G-027, G-031, G-032, G-033, G-044, G-047, G-028, G-029 | Weeks 7+ (parallel) and Weeks 26+ | O2 at scale, O9 polish, security hygiene |

*Gaps not explicitly listed are already Closed: G-025 (probe infra, ADR-0041).*

## Phase gating

Each phase has one or more **exit gates** that must pass before the next phase starts:

- **Phase 1 exit:** G-036 verification middleware deployed to staging; one internal `cs_live_*` key minted and exercised.
- **Phase 2 exit:** `/v1/consent/verify` and `/v1/consent/record` both return spec-compliant responses in staging; whitepaper §5 defensibly distributable.
- **Phase 3 exit:** Zero-storage invariant test passes (no personal data in persistent tables for a zero-storage org after 1,000 events); Healthcare template seeded and visible in admin console.
- **Phase 4 exit:** Deletion orchestrator demonstrably suppresses a BFSI KYC-retention artefact while deleting a paired marketing artefact; orphan-event alert delivered end-to-end in a forced-failure test.
- **Phase 5 exit:** Friendly-partner webhook integration has processed ≥100 deletions; status page live; on-call rotation documented.
- **Phase 6 exit:** Node + Python libraries published; OpenAPI CI drift check active on main.
- **Phase 7 exit:** All 11 connectors listed as Shipping in the revised Appendix D are actually shipping with test-account integration tests passing.
- **Phase 8 exit:** Documented load-test results against SLO; SOC 2 audit observation period confirmed started.

Failure of a gate blocks the start of the next phase (not the start of overlapping parallel sprints within the same phase).

## Parallelism

Some phases can overlap:

- **Phases 1 + 8 partial:** status-page groundwork from G-015 can start in Phase 1 if idle capacity exists.
- **Phases 3 + 4:** the regulatory exemption engine (G-007) can start during Phase 3 Sprint 3 since it has no schema dependency on zero-storage.
- **Phases 5 + 6:** client libraries (Phase 6) can begin once Phase 2 exits — they do not require Phases 3/4/5 complete.
- **Phases 7 + 8:** most connector work (Phase 7) runs in parallel with Phase 8 polish.

Overlap is **opportunistic**, not the default — sequencing above assumes solo execution with contractor capacity added after G-013 closes.

## Dependencies across phases

```
Phase 1 (API scaffolding)
    ├──▶ Phase 2 (all /v1/* endpoints)
    │        ├──▶ Phase 6 (client libraries wrap /v1/*)
    │        └──▶ Phase 5 (G-049 rights API)
    ├──▶ Phase 3 (Sandbox orgs use API keys)
    └──▶ Phase 4 (G-007 exposed via authenticated API too)

Phase 2 ─▶ Phase 4 (G-007 consults artefact data_scope from real artefacts)
Phase 3 ─▶ Phase 5 (webhook reference partner needs processing mode clarity)
Phase 4 ─▶ Phase 7 (Razorpay connector G-017 depends on G-007)
```

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| G-036 design drift between Phases 1 and 2 | Medium | High — every later `/v1/*` inherits it | OpenAPI stub lands in Phase 1; Phase 2 endpoints validate against it |
| G-008 legal-review slippage | High | Medium — blocks G-007 for BFSI customers | Engage two firms in parallel; accept review of "core 5 statutes" as minimum to unblock customers |
| BFSI reference partner for G-011 unavailable | Medium | Medium — case study weaker without one | Fallback: internal sample backend using same protocol; anonymised case study |
| Zero-storage data-plane complexity underestimated (G-005) | Medium | High — Phase 3 exit gate | Budget a 2-week buffer; consider reducing initial zero-storage scope to "storage-mode enforcement + BYOS only" and defer memory-only buffer to a follow-up |
| Solo execution at G-013 cap (2 simultaneous BFSI integrations max) | High | Medium — limits revenue ramp | Prioritise G-013 during Phase 5; have named contractors identified before first customer signs |
| Whitepaper drift mid-execution (claims change as code lands) | High | Low — manageable via CC-F + G-045 | Any `/v1/*` shape change in a sprint updates whitepaper in same commit; G-045 CI check enforces post-Phase-6 |
| Supabase `sb_secret_*` JWT gateway gap (from memory) | Low | Low | Track via V2-K1; does not block this plan |

## Milestone schedule

Assuming start date **2026-04-22** (next Monday) and solo execution:

| Date (approx.) | Milestone |
|---|---|
| 2026-05-05 | Phase 1 complete — API keys minted, Bearer middleware live in staging |
| 2026-05-19 | Phase 2 complete — whitepaper defensibly distributable |
| 2026-06-16 | Phase 3 complete — Zero-Storage + Insulated validated, Healthcare template shipped |
| 2026-07-14 | Phase 4 complete — regulatory retention, material-change, silent-failure |
| 2026-08-11 | Phase 5 complete — ops maturity, first BFSI-signable product |
| 2026-09-01 | Phase 6 complete — client libraries published, OpenAPI CI active |
| 2026-11-03 | Phase 7 complete — connector catalogue honest |
| 2026-12-15 | Phase 8 ongoing; P3 items deferred per capacity |

Dates are solo-execution targets. Contractor capacity after G-013 can compress Phases 6–8 by ~30%.

## How this plan is operated

1. Open ADR-1001 (Proposed status); start Sprint 1.1 (per the ADR's plan section).
2. When Sprint 1.1 completes: run tests, record results in the ADR, update changelog, commit, then start Sprint 1.2.
3. When all sprints in ADR-1001 complete: mark ADR Completed, update ADR-index, evaluate Phase 1 exit gate. If passed: start ADR-1002.
4. Repeat through ADR-1008.

The plan is maintained in this file. Gap closures flow from the gap doc (Combined) → the owning ADR → here (the Phase gains a ✓). When all eight Phases are Completed, the v2.0 whitepaper is fully delivered.

---

## Phase status (updated as phases complete)

| Phase | ADR | Status | Completed date |
|---|---|---|---|
| 1 | ADR-1001 | Proposed | — |
| 2 | ADR-1002 | Proposed | — |
| 3 | ADR-1003 | Proposed | — |
| 4 | ADR-1004 | Proposed | — |
| 5 | ADR-1005 | Proposed | — |
| 6 | ADR-1006 | Proposed | — |
| 7 | ADR-1007 | Proposed | — |
| 8 | ADR-1008 | Proposed | — |

*Next scheduled review: end of Phase 1 (~2026-05-05).*
