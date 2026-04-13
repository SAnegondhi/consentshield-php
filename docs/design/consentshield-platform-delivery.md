# ConsentShield — Platform Delivery Analysis

*Customer experience perspective · April 2026*

---

## The Central Question

ConsentShield has two fundamentally different modes of use, and they pull in opposite directions:

**Setup mode** — building a consent banner, filling out a data inventory, generating an audit report — is inherently a long-session, large-screen, mouse-and-keyboard task.

**Monitor mode** — checking compliance score between patients, receiving a rights request alert at 7 PM on a Friday, triggering a breach notification in an emergency — is inherently a glance, a tap, a push notification.

No single platform handles both well. The recommendation that follows is built around that reality.

---

## Recommendation

**Web app (primary) + Native mobile app (companion)**

Not a PWA. Not web-only. Not mobile-only. A deliberate split where each platform does only what it does best, and the two surfaces work together.

---

## Why Not PWA

PWA feels like the pragmatic middle path but fails on the two things that matter most for this product.

**Push notifications on iOS are unreliable.** iOS PWA push support was only added in 2023, requires Safari specifically, and has a meaningful real-world failure rate. A rights request SLA missed because a push notification didn't deliver is a compliance failure — the 30-day clock doesn't pause because the alert didn't arrive. Native iOS push has no equivalent reliability problem.

**The ABHA QR scan needs native camera.** The clinic patient consent flow — where a doctor scans a patient's ABHA QR code to pull consent-gated health records — requires reliable camera API access. PWA camera on iOS is inconsistent across browser versions and device configurations. This is not a graceful degradation scenario; it is a broken core workflow.

**The banner builder is unusable on a 390px screen regardless of the technology.** A drag-and-drop live preview builder with code snippet copy is a desktop task. Making it a PWA does not change that.

---

## Activity-to-Platform Matrix

| Activity | Frequency | Web | Native mobile | PWA | Rationale |
|---|---|:---:|:---:|:---:|---|
| Consent banner builder | Once at setup | ★★★★★ | ★ | ★★ | Drag-drop, live preview, code copy — needs a real screen |
| Data inventory wizard | Once at setup | ★★★★★ | ★ | ★★ | Long relational form, many interdependent fields |
| Privacy notice builder | Once at setup | ★★★★★ | ★★ | ★★★ | Text editing, PDF download |
| Compliance dashboard | Daily monitoring | ★★★★ | ★★★★★ | ★★★★ | Quick status glance = mobile wins |
| Rights request — alert | Any time | ★★ | ★★★★★ | ★★★ | Must not miss this; push notification is critical |
| Rights request — respond | Weekly | ★★★★★ | ★★★ | ★★★ | Full guided workflow, template editing |
| Audit report export | Monthly | ★★★★★ | ★ | ★ | PDF generation, in-browser preview, download |
| Breach notification trigger | Emergency | ★★★★ | ★★★★★ | ★★★ | Urgency demands a mobile shortcut |
| Analytics — consent rate | Weekly | ★★★★★ | ★★★ | ★★★ | Charts and data tables need screen real estate |
| Clinic patient consent flow | Every patient | ★ | ★★★★★ | ★★★ | Patient interaction is at the bedside, not a desk |
| ABHA QR code scan | Every patient | ★ | ★★★★★ | ★★ | Needs reliable native camera API |
| Team and billing settings | Rare | ★★★★★ | ★★ | ★★ | Admin tasks belong on desktop |

---

## Platform Strengths and Weaknesses

### Desktop web app

The primary surface. Delivers everything that requires a real screen, a keyboard, file downloads, and complex multi-step workflows.

**What it does well**

- Full consent banner builder with live preview pane
- PDF audit report generation, in-browser preview, and download
- Data-dense tables: processing logs, analytics, rights request queue
- Privacy notice wizard with all DPDP-required disclosure fields
- Multi-property management across accounts
- Always up to date — no install, no app store cycle
- Works on any device with a browser including clinic front-desk computers

**Where it falls short**

- No reliable push notifications without PWA, and PWA push is unreliable on iOS
- A browser tab that is closed or backgrounded will not surface a compliance alert
- Complex form workflows on a mobile browser screen are painful
- Bedside patient consent interaction is wrong on a laptop

---

### Native mobile app (iOS + Android)

The companion surface. Deliberately narrow. Does three things exceptionally well and delegates everything else back to the web app.

**What it does well**

- Reliable push notifications on both iOS and Android — the only delivery method that guarantees an alert surfaces on a locked screen at 10 PM on a Sunday
- Native camera for ABHA QR code scan — consistent, fast, no browser compatibility issues
- Touch-optimised patient consent flow for clinic bedside use
- Compliance score glance in under five seconds between patients
- Quick rights request approve / reject without opening a laptop
- Emergency breach notification trigger as a single-screen shortcut
- Functions in poor clinic WiFi with offline-first data caching

**Where it falls short**

- Cannot do the consent banner builder — the drag-drop preview is a desktop feature
- PDF download and preview experience is poor on mobile
- All initial configuration and reporting tasks route back to web
- Requires app store installation — adds friction for non-clinic users who only need web

---

### PWA — why it is the wrong primary choice

| Capability | PWA on iOS | PWA on Android | Native |
|---|---|---|---|
| Push notifications | Unreliable — Safari only, iOS 16.4+, significant real-world failure rate | Works reasonably — Chrome and others | Fully reliable |
| Camera API (ABHA scan) | Inconsistent across browser versions | Generally works | Native, always works |
| Home screen presence | Requires manual Safari install prompt | Works well | App Store discovery |
| Complex UI (banner builder) | Same as desktop web — no improvement | Same as desktop web | No improvement |
| Offline capability | Limited | Moderate | Full offline-first possible |

A PWA is appropriate when the product has a single primary use case that is roughly equivalent on both screen sizes, and when push notification reliability is not business-critical. ConsentShield has neither condition.

---

## User Journey Breakdown

### SaaS founder / CTO

*5–50 person company, technically literate, seed or Series A*

**Platform verdict: Web primary, mobile for alerts**

| Moment | Platform | Reason |
|---|---|---|
| Initial setup (consent banner, data inventory, snippet deployment) | Web | Complex multi-step wizard; needs to copy JS code and test integration live |
| Weekly compliance check | Web or mobile | Desktop if at work, mobile if traveling — needs to work on both |
| Rights request received alert | Mobile push | 30-day SLA clock starts immediately — missing this on a weekend matters |
| VC due diligence audit export | Web | Generating, previewing, and downloading a PDF audit package |

---

### Compliance / Legal head

*Desk-bound role, manages all rights requests and audit evidence*

**Platform verdict: Web primary, mobile for alerts and emergencies**

| Moment | Platform | Reason |
|---|---|---|
| Rights request queue — review and respond | Web | Guided 7-step workflow with form editing and template drafting |
| SLA deadline approaching alert | Mobile push | Without native push, the 5-day warning may be missed entirely |
| Monthly processing log review | Web | Data-dense table with purpose and date filters — mobile view is painful |
| Breach detected at 11 PM | Mobile | Emergency action cannot wait until morning. Mobile breach trigger shortcut is critical. |

---

### Clinic owner / Doctor

*1–5 doctor practice, Hyderabad or Tier-2 city*

**Platform verdict: Mobile primary, web for setup only**

| Moment | Platform | Reason |
|---|---|---|
| Patient walks in — ABHA QR scan | Mobile / tablet | The patient is standing there. This is a bedside interaction. |
| Patient gives DPDP consent | Mobile / tablet | Patient touches approve on clinic tablet. Must be a native touch experience. |
| Between-patient compliance check | Mobile | Standing, phone in hand. A 10-second glance — not a laptop task. |
| Initial clinic setup (data inventory, DPDP notice) | Web | One-time task done at a desk — benefits from full screen |

---

### CA / Legal firm partner

*Managing 10–30 white-label client accounts*

**Platform verdict: Web primary, mobile for client alerts**

| Moment | Platform | Reason |
|---|---|---|
| Multi-client compliance overview | Web | Multi-account dashboard is column-heavy — needs screen space |
| Client audit report generation | Web | PDF export, logo customisation, share-link generation |
| Client rights request alert | Mobile push | CA acts as compliance manager for clients — needs the same alert the client gets |
| Client onboarding via screen share | Web | Screen share during a call is always a desktop task |

---

## Feature-to-Platform Mapping

| Feature | Primary platform | Secondary / companion |
|---|---|---|
| Consent banner builder | Web | — |
| Data inventory wizard | Web | Read-only mobile view |
| Privacy notice builder | Web | — |
| Compliance dashboard | Web | Mobile glance view |
| Rights request — notification | — | Mobile push (primary delivery) |
| Rights request — respond | Web | Mobile quick approve / reject |
| Breach notification trigger | Web | Mobile shortcut (emergency) |
| Audit report export | Web | — |
| Analytics — consent rate | Web | Mobile summary card |
| Clinic patient consent flow | — | Mobile / tablet (primary) |
| ABHA QR code scan | — | Mobile native camera |
| Team and billing settings | Web | — |

---

## The Mobile App's Scope

The mobile app should be deliberately narrow at launch. A small, fast, focused app is more likely to be installed and kept than a full product replica.

**What to build in the mobile app**

- Compliance score dashboard (score, status of the four core pillars, days until enforcement)
- Rights request inbox with push notification entry point — show the request detail, offer quick approve / reject / escalate actions; full response workflow opens on web
- Breach notification shortcut — single large-tap trigger that starts the 72-hour workflow, then hands off to web for the full form
- Clinic patient flow — ABHA QR scan, consent banner display, patient approval capture, record confirmation
- SLA countdown for open rights requests with in-app notification

**What to explicitly exclude from the mobile app**

- Consent banner builder
- Data inventory forms
- Privacy notice wizard
- Audit report generation and PDF export
- Analytics charts
- Multi-property management
- Team and billing settings

Any workflow the user starts on mobile that requires more than three taps should show a prompt: *"Continue on desktop at app.consentshield.in"* with a deep link that opens the right screen on web.

---

## Implementation Sequencing

From a customer experience standpoint, the sequencing should match where the first customers are.

**Months 1–4:** Web app only. The first customers are SaaS founders — they are desk-bound, technically literate, and will set up the product from a laptop. A mobile app is not blocking their purchase decision.

**Months 5–8:** Begin mobile app development in parallel with Phase 2 web features. Target launch to coincide with the first ABDM clinic pilots. The clinic customer cannot be served well without it.

**Month 8 onwards:** Both surfaces live. Web for setup and reporting, mobile for monitoring and clinic workflows. Each platform surfaces a clear call-to-action when the user needs to switch.

---

## Design Principles for the Split

**Do not build two separate products.** The web app and mobile app share the same data, the same compliance scores, and the same audit logs. A rights request acknowledged on mobile should appear as in-progress on web immediately.

**Design the handoff deliberately.** Any mobile screen that opens into a complex workflow should offer a single clear action: *"Full response on desktop."* Any web screen for an activity that belongs on mobile (breach trigger, patient consent) should say *"Use the ConsentShield app for this."*

**The mobile app's empty state is the web app.** If a user installs the mobile app but has not completed web onboarding, the app shows their compliance score (probably 0%) and a single call to action: *"Complete setup at app.consentshield.in."* The mobile app never pretends to be a complete product.

**Push notifications are the mobile app's primary value.** The app should ask for notification permission on first launch, explain clearly what it will send (rights request alerts, SLA warnings, breach events), and never send anything else. Notification fatigue kills the one feature that makes the mobile app worth installing.

---

*Document prepared April 2026. Platform capabilities — particularly iOS PWA push notification support — should be re-verified before final technical decisions are made, as Apple's PWA support has been evolving.*
