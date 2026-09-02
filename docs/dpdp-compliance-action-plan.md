# DPDP Act 2023 — Compliance Action Plan for the Ally Platform

> **Status:** Draft for review by counsel and engineering leadership
> **Instrument:** The Digital Personal Data Protection Act, 2023 (No. 22 of 2023), notified in
> the Gazette of India as `CG-DL-E-12082023-248045` on 11 August 2023, read with the
> **Digital Personal Data Protection Rules, 2025**, notified 13 November 2025.
> **Hard deadline:** **13 May 2027** — the end of the 18-month phased rollout. No grace period
> is expected.
> **Prepared:** 2026-09-02 · **Time remaining:** ~8 months
> **Scope:** `ally-be`, `ally-ai`, `ally-ai-learn`, `ally-web`, `ally-mobile`, `infra`

---

## 0. How to read this document

Section 1 states what the law requires and when. Section 2 establishes Ally's role and who
the data principals actually are — this is the single most consequential judgement in the
document and it drives everything after it. Section 3 is the gap analysis: every obligation
mapped to what the code does *today*, with file references. Section 4 is the sequenced action
plan. Section 5 lists the questions only counsel can close, and the assumptions engineering
has proceeded on in the meantime.

**A note on sourcing.** This session's network policy blocked `egazette.gov.in`,
`meity.gov.in` and `indiacode.nic.in`, so the bare Act text could not be fetched and pinned
line-by-line. Obligations below are stated at section level and are reliable at that
granularity; **exact subsection lettering and the penalty figures in §1.4 must be verified
against the gazette PDF before this plan is relied on externally.** Every statement about
*Ally's code* was verified by reading the code and is cited.

**A note on product judgement.** The consent, notice and erasure surfaces designed here
involve real product decisions — wording, timing, what a screen shows and omits. Per the
repo `CLAUDE.md` files these should be checked against Stacks. The Stacks MCP server was not
reachable in this session (no `gh` login, egress blocked), so the UX proposals below are
engineering's first cut and are explicitly **marked for a Stacks pass before implementation.**

---

## 1. What the law requires

### 1.1 Applicability

The Act governs **digital personal data**. It applies to processing inside India, and to
processing outside India where that processing is connected to offering goods or services to
data principals in India (§3). Ally processes personal data of counsellors, community health
workers, learners and help-seekers in India. **The Act applies in full.**

Personal data is any data about an identifiable individual. Note what this sweeps in that a
"we don't collect PII" instinct would miss: a counselling call recording, a session transcript,
a WhatsApp message body, a learner's simulation performance history, and an IP address in an
audit log are all personal data.

The Act has **no separate category for sensitive personal data** — unlike the GDPR or the old
SPDI Rules, health and mental-health data carry no distinct legal tier. In practice this means
Ally cannot rely on a lower standard for ordinary data; it must apply one high standard to all
of it. It also means the platform's existing HIPAA-driven controls are a *head start*, not a
defence: HIPAA and DPDP overlap on encryption and audit, and diverge sharply on consent,
notice, erasure and data-principal rights, where HIPAA gave Ally nothing to build on.

### 1.2 Phased commencement

| Date | What becomes live | Status as of 2026-09-02 |
|---|---|---|
| 13 Nov 2025 | Rules 1, 2, 17–21 (definitions, Board constitution and procedure) | In force |
| **13 Nov 2026** | **Rule 4 — Consent Managers** | **~10 weeks away** |
| **13 May 2027** | Notice, consent, security safeguards, breach notification, retention/erasure, children's data, data-principal rights, Significant Data Fiduciary obligations | **~8 months away** |

The 13 May 2027 date is what matters for engineering. Rule 4 matters only if Ally chooses to
obtain consent through a registered Consent Manager — a decision that must be *taken*, not
drifted past (see §5, Q4).

### 1.3 The obligations, grouped as engineering work

**Grounds for processing (§4, §6, §7).** Processing needs either consent or an enumerated
"legitimate use". Consent must be free, specific, informed, unconditional and unambiguous,
given by a clear affirmative action, and limited to the data necessary for the stated purpose.
It must be withdrawable **with the same ease** with which it was given, and withdrawal must
trigger erasure. Critically, the fiduciary must be able to **demonstrate** that valid consent
was obtained — which makes consent a *record-keeping* requirement, not just a UI requirement.

**Notice (§5, Rule 3).** At or before consent, an itemised notice must state the personal data
collected, the purpose, how to exercise rights, how to withdraw consent, and how to complain to
the Data Protection Board. It must be independent of other text (not buried in T&Cs) and
available in English or **any language in the Eighth Schedule** — which includes Malayalam,
Tamil and Kannada, the languages Ally already ships.

**Security safeguards (§8, Rule 6).** Encryption, obfuscation or masking of personal data;
access control on computer resources; monitoring for unauthorised access; measures enabling
detection and investigation of breaches; **retention of logs for at least one year**; and
contractual security terms binding processors.

**Breach notification (Rule 7).** On becoming aware of a personal data breach: notify **each
affected data principal without delay**, describing the nature, extent and timing of the breach,
its likely consequences, mitigation taken, steps the individual should take, and a contact who
can answer questions. Notify the Board without delay with initial particulars, followed by a
**detailed report within 72 hours** (extendable on request).

**Retention and erasure (§8, Rule 8, Third Schedule).** Erase personal data when the purpose is
served or consent is withdrawn, unless retention is legally required. For classes specified in
the Third Schedule, erase after the prescribed period of data-principal inactivity. Give the
data principal **at least 48 hours' advance notice** before erasing. Cause processors to erase too.

**Data-principal rights (§11–§14).** Right to access a summary of personal data and processing
activities and the identities of fiduciaries/processors it was shared with; right to correction,
completion, updating and erasure; right to grievance redressal, with a published contact and a
defined response period; right to nominate another individual to exercise rights in the event of
death or incapacity.

**Children (§9, Rule 10).** For anyone **under 18**: verifiable consent of a parent or lawful
guardian before processing, with the parent's identity and adulthood checked against reliably
held identity details, a virtual token, or a Digital Locker / authorised identity service. Plus
an outright prohibition on **tracking, behavioural monitoring and targeted advertising** directed
at children. Rule 12 provides narrow conditional exemptions for specified classes including
healthcare establishments and educational institutions.

**Significant Data Fiduciary (§10, Rule 13).** If notified as an SDF: appoint a **DPO based in
India** reporting to the board or management; conduct an **annual DPIA**; commission an **annual
independent audit** and report findings to the Board; exercise **due diligence over algorithmic
software** to verify it poses no risk to data-principal rights; and comply with any Government
restriction on transferring specified personal or traffic data abroad.

**Cross-border transfer (§16).** Transfer is permitted by default and restricted by exception:
the Government may bar transfers to notified countries. This is materially more permissive than
the GDPR — but it is a *standing* risk, because a notification could land with little notice and
Ally's AI pipeline is built on non-Indian providers.

**Processors (§8).** Ally remains fully liable for its processors. Processing may only be
entrusted to a processor **under a valid contract**, and Ally must be able to cause its
processors to erase data on instruction.

### 1.4 Exposure

Penalties are levied by the Data Protection Board under §33 and the Schedule. Indicative maxima
— **verify against the gazette before external use**:

| Failure | Maximum penalty |
|---|---|
| Failure to take reasonable security safeguards | **₹250 crore** |
| Failure to notify a personal data breach | **₹200 crore** |
| Non-fulfilment of children's-data obligations (§9) | **₹200 crore** |
| Non-fulfilment of Significant Data Fiduciary obligations (§10) | **₹150 crore** |
| Any other contravention | **₹50 crore** |

The two largest heads — security safeguards and breach notification — are precisely the two
where Ally's gaps are structural rather than cosmetic (§3.5, §3.7).

---

## 2. Ally's role, and who the data principals are

### 2.1 Ally is a Data Fiduciary

Ally determines the purpose and means of processing: it decides that calls are recorded, that
transcripts are embedded into a vector store, that summaries are generated by third-party LLMs.
Customer organisations (tenants) configure Ally, but they do not determine its architecture.
**Ally is a data fiduciary, not merely a processor**, and cannot discharge these obligations by
pointing at tenant contracts.

A defensible secondary reading is that Ally is a *processor* for tenant-owned help-seeker data
and a *fiduciary* for its own platform data. That reading does not reduce the engineering work
— a processor still needs erasure-on-instruction, security safeguards, breach reporting to the
fiduciary and contractual terms — it only changes who notifies whom. **Engineering should build
to the fiduciary standard regardless**, and let counsel decide the labelling (§5, Q1).

### 2.2 There are two populations, and the code only knows about one

This is the crux of the whole exercise.

| Population | Is a data principal? | Exists in the data model as… |
|---|---|---|
| Counsellors, CHWs, learners, admins | Yes | A `users` row — authenticated, addressable, deletable in principle |
| **Help-seekers / callers / clients** | **Yes** | **Content only** — a `call_details.transcript`, `messages.content`, a `wa_contact` phone number, an S3 recording, a Weaviate `Conversation` object. **No identity record, no account, no address.** |

Every data-principal right presumes the platform can *find* a person's data and *reach* them.
For help-seekers Ally can do neither:

- **Consent** is currently obtained *by the counsellor, off-platform, verbally*. The
  `StartSessionDialog` / `StartSessionModal` consent gate is explicit that a counsellor's tap is
  the confirmation that a consent line was read aloud
  (`ally-web/apps/ally-helpline-dashboard/src/pages/calls/components/StartSessionDialog.tsx:13-19`,
  `ally-mobile/src/screens/CallLog/components/StartSessionModal/StartSessionModal.tsx:22-30`).
  Nothing is persisted. Ally cannot demonstrate consent for a single help-seeker.
- **Erasure** has no subject key. "Delete everything about this caller" is not an expressible
  query; there is no caller identifier to filter on.
- **Breach notification** is therefore not merely unimplemented but *architecturally
  impossible*: Rule 7 requires notifying each affected data principal, and Ally holds no contact
  details for the population whose most sensitive data it stores.

**This is the finding to escalate.** It is not a feature gap that can be closed in the last
sprint before May 2027; it requires a data-model decision (Workstream A) that everything else
depends on. The WhatsApp module is the one place that got this right — `wa_contact` keys on a
phone number, which is why it is also the only module with working erasure
(`ally-be/src/whatsapp/service/whatsapp-conversation.service.ts:263-265`).

### 2.3 Ally is plausibly a Significant Data Fiduciary

SDF status is conferred by Government notification, on factors including volume and sensitivity
of data processed and risk to data principals' rights. A platform recording mental-health
helpline conversations at multi-tenant scale is a natural candidate. **Plan for SDF designation
rather than hoping to avoid it** — the SDF obligations (India-based DPO, annual DPIA, annual
independent audit, algorithmic due diligence) have long lead times, and being designated without
them in place is a ₹150 crore head of liability.

Algorithmic due diligence deserves specific attention: Ally's live agent makes
in-conversation decisions about a distressed person via `ally-ai-learn`'s LLM pipeline, with
documented known failure modes (STT confidence unusable for Indian languages;
per-language provider variance — `ally-ai-learn/CLAUDE.md`). That is exactly the surface Rule 13
asks a fiduciary to have examined and documented.

---

## 3. Gap analysis

Legend: **🔴 absent** · **🟡 partial** · **🟢 substantially in place**

### 3.1 🔴 Consent capture and demonstrability (§6, Rule 3)

**Today.** There is no consent record anywhere in the schema. Grepping 121 tables for consent
primitives returns only the WhatsApp module and unrelated seed data. What exists is:

- `users.termsAndAgreementApproved` (boolean) and `users.termsAndAgreementApprovedAt`
  (`ally-be/src/user/entity/user.entity.ts:56-60`). One bit for the entire relationship.
- A `TermsAndAgreementModal` on mobile and `Terms.tsx` / `Privacy.tsx` pages on web.
- The verbal help-seeker consent gate described in §2.2, which persists nothing.

**Gap.** The boolean cannot support any of: (a) *which version* of the notice was accepted —
so a notice change silently re-labels every historical acceptance; (b) *purpose-specific*
consent — recording, transcription, LLM summarisation, vector embedding for RAG, and analytics
are distinct purposes and one flag cannot evidence consent to each; (c) *withdrawal* — there is
no way to record it and no path to act on it; (d) *language* — §5(3) makes the language of
notice legally material and it is not captured; (e) *help-seeker consent at all*.

Note also that a single accept-everything flag is in tension with §6's "free" and
"unconditional" requirements: consent to optional processing (analytics, model improvement)
cannot be bundled with consent to the service itself.

### 3.2 🟡 Notice (§5, Rule 3)

**Today.** `ally-web/apps/ally-admin-dashboard/src/pages/Privacy/Privacy.tsx`,
`ally-web/apps/ally-helpline-dashboard/src/pages/legal/Privacy.tsx`,
`ally-mobile/src/constants/terms.ts`.

**Gap.** The surfaces exist; their *content* has not been audited against Rule 3's itemisation,
and none of them names a grievance contact or the Board complaint route — a platform-wide grep
for `grievance`, `DPO` or `privacy@` across all five code repos returns **nothing**.

Two Ally-specific traps make this harder than a copy edit:

1. **The notice must be readable in the data principal's language.** `ally-mobile`'s bundled
   fonts carry no Indic glyphs, and Malayalam/Tamil/Kannada text can render as *nothing at all*
   on some Android ROMs (`ally-mobile/CLAUDE.md`). A notice that renders blank is not notice.
   Any consent screen shipped in an Indic language must be verified on a real device.
2. **Released mobile builds are frozen contracts.** Users stay on old versions for a long time.
   A consent flow that only exists in the latest build leaves a long tail of users consenting
   under the old regime, so the server must treat notice version as data and be able to
   re-prompt — not assume the client is current.

### 3.3 🔴 Data-principal rights: access, correction, erasure, nomination (§11–§14)

**Today.** Nothing. There is no subject-access endpoint, no data-export endpoint, no correction
endpoint beyond ordinary profile editing, no nomination concept, and — notably — **no account
deletion endpoint of any kind**. The `@Delete` routes in the user domain remove a *role*, a
*profile image*, or an *admin-tenant mapping*
(`ally-be/src/user/controller/user.controller.ts:152,426,458`), and
`platform-admin.controller.ts:85` removes a platform-admin grant, not a user. A user cannot
delete their Ally account.

**Gap.** All four rights need building from zero, plus a grievance intake with a tracked
response clock.

### 3.4 🔴 Retention and erasure (§8, Rule 8, Third Schedule)

**Today.** Exactly one module ages out personal data: `WhatsAppRetentionService`
(`ally-be/src/whatsapp/service/whatsapp-retention.service.ts`). It is genuinely good work — a
daily sweep, configurable window with an explicit off switch, batched to bound lock duration,
idempotent by construction, blanking content in place while preserving aggregate counts so
historical usage figures don't silently rewrite themselves, and logging at info so a job that
quietly does nothing is distinguishable from one that works. **This is the pattern to
generalise, not to reinvent.**

**Gap.** Everything else retains forever:

| Store | Personal data | Retention today |
|---|---|---|
| `messages.content` | Counselling conversation content | None |
| `call_details.transcript`, `.summary` | Call transcripts and summaries | None |
| `scenario_report_transcripts` | Learner simulation transcripts | None |
| `chat_custom_field_values` | Tenant-defined fields about help-seekers | None |
| S3 | Call and session recordings, uploaded audio | None (no lifecycle policy found) |
| Weaviate `Conversation` | Embedded conversation turns | None |
| Redis, SQS | Transient session state; inbound WhatsApp bodies | Queue retention noted as a live exposure in `whatsapp-inbound.producer.ts:29-30` |
| `learner_supervisor_memory` | Supervisor notes on learners | **Explicitly open** — the migration comment records that retention "is a question nobody has answered yet" (`1926000000000-CreateLearnerSupervisorMemory.ts:26`) |

There is also no mechanism for the **48-hour pre-erasure notice** Rule 8 requires.

### 3.5 🔴 Erasure does not cascade across stores

**Today.** Postgres uses soft deletes (`deleted_at`) nearly everywhere — which is a *tombstone,
not an erasure*, and does not satisfy §8 or §12. `ally-ai` does have the right primitive:
`delete_by_filter` in `ally-ai/app/core/vector_db/weaviate.py:263`, carefully written to refuse a
match-everything filter. **Nothing calls it in service of a data-principal erasure.**

**Gap.** An erasure request must fan out to Postgres (hard-delete or crypto-shred), Weaviate,
S3, Redis and any in-flight SQS message, and must be able to *prove* it completed. None of that
orchestration exists. This is why §2.2's identity gap is load-bearing: without a subject key
there is nothing to fan out *on*.

### 3.6 🟡 Security safeguards (§8, Rule 6)

**🟢 What is genuinely in place.** Application-level AES-GCM encryption of the most sensitive
columns via `CryptoService` and `PHI_DATA_ENCRYPTION_KEY`
(`ally-be/src/common/service/crypto.service.ts`, applied in `message.service.ts`,
`call-details.service.ts`, `chat-ai-service.ts`, backfilled by migration
`1759141900000-encryptSensitiveDataForHIPAA.ts`). Strong multi-tenant isolation via `tenant_id`.
A real RBAC model with permissions unioned across groups. A dedicated audit path with 175 call
sites. Phone-number masking in the WhatsApp admin UI. This is well above the baseline for a
platform of this size, and Rule 6 credit should be claimed for it.

**🟡 Where it stops short.**

1. **The same content is encrypted in one store and plaintext in another.** The HIPAA migration
   encrypts `messages.content` and `call_details.transcript`/`.summary` — but Weaviate's
   `Conversation` collection stores `message` as a plain `TEXT` property
   (`ally-ai/app/core/vector_db/constants.py:70-72`). Conversation content is embedded into the
   vector store *in the clear*. The encryption boundary has a hole in it precisely where the
   data was copied.
2. **Unencrypted personal data elsewhere**: `scenario_report_transcripts`, `wa_message.body`
   (masked in UI, not encrypted at rest), `chat_custom_field_values`, and
   `audit_logs.ipAddress` — an IP plus a derived city/country
   (`ally-be/src/audit/service/audit-logger.service.ts:88-91`) is personal data in an
   unencrypted column.
3. **No S3 server-side encryption in code.** A grep for `ServerSideEncryption`, `SSEAlgorithm`
   or `kms` across `ally-be/src` and `infra/ansible` returns nothing. Recordings may be covered
   by a bucket default policy, but that is unverified and unenforced by code — an uploader that
   omits SSE against a bucket without a default writes plaintext audio.
4. **The encryption migration swallows its own failures.** `encrypt()` catches, warns, and
   **returns the original plaintext** (`1759141900000-...ts:29-31`), and `decrypt()` does the
   same. A key misconfiguration during the backfill would have left rows silently unencrypted
   with a `console.warn` as the only trace. Whether that happened in production is worth
   verifying now, not after a breach.
5. **Audit logging can be silently off, and there are two of it.** Two independent audit
   implementations coexist: `AuditLoggerService` writes to CloudWatch (with a geo-IP lookup
   added) and `AuditLogService` writes the `audit_logs` Postgres table (`src/audit/service/`).
   Neither is a superset of the other and nothing declares which is authoritative. Both
   **swallow their own failures** — `AuditLogService` catches and logs at error
   (`audit-log.service.ts:53-56`), while `AuditLoggerService` becomes a complete no-op when
   `ENABLE_AUDIT_LOGS_TO_CLOUDWATCH=false` and `ENABLE_CONSOLE_AUDIT_LOGS` is unset
   (`audit-logger.service.ts:33-39,113-118`). Rule 6 requires logs; this design permits their
   absence with no alarm.
6. **Log retention is not set to one year.** Rule 6 requires ≥1 year. No CloudWatch retention
   policy appears in `infra/ansible`; the only retention value found platform-wide is Consul's
   `prometheus_retention_time = "1h"`.

### 3.7 🔴 Breach notification (Rule 7)

**Today.** No breach register, no incident workflow, no notification channel, no runbook.

**Gap.** Rule 7's 72-hour clock is a process obligation, but it rests on three technical
capabilities Ally lacks: (a) **detection** — knowing a breach occurred; (b) **enumeration** —
determining *which* data principals were affected, which requires per-subject data lineage
Ally does not have; (c) **notification** — reaching them, impossible today for help-seekers
(§2.2). A breach discovered next week could not be lawfully reported.

### 3.8 🔴 Children's data (§9, Rule 10)

**Today.** There is **no age, date-of-birth, or minority signal anywhere in the platform** — a
grep across the user and auth domains for `age`, `dateOfBirth`, `dob`, `minor`, `guardian` and
`parental` returns nothing.

**Gap.** Ally cannot tell whether it is processing a child's data, which means it cannot comply
with §9 and cannot demonstrate that it doesn't need to. Two distinct exposures:

1. **Help-seekers.** A mental-health helpline serving Indian communities will receive calls from
   under-18s. Those calls are recorded, transcribed, sent to third-party LLMs and embedded into a
   vector store, with no parental consent and no age check.
2. **Learners.** If any deployment includes under-18 learners, the §9(3) prohibition on
   **tracking and behavioural monitoring** collides directly with Ally's PostHog analytics and
   with per-learner progress and performance tracking — features, not incidental logging.

Rule 12's conditional exemptions for healthcare establishments and educational institutions may
cover part of this. That is a legal determination, and it is the highest-value question on the
list (§5, Q3), because a ₹200 crore head of liability turns on it.

### 3.9 🟡 Processors and cross-border transfer (§8, §16, Rule 13)

**Today.** Personal data — including counselling content — flows to a substantial set of
third-party processors, most outside India:

| Processor | Data | Where |
|---|---|---|
| OpenAI | Transcription, summarisation, text generation | `ally-ai/app/core/transcriptions/services/openai_service.py`, `ally-ai/app/core/text_generations/`, `ally-ai-learn/app/llms/openai.py` |
| Google / Gemini | LLM, STT, TTS | `ally-ai-learn/app/llms/gemini.py`, `app/stt/google.py`, `app/tts/google.py` |
| Deepgram | STT, TTS | `ally-ai-learn/app/stt/deepgram.py`, `app/tts/deepgram.py`, `ally-ai/.../deepgram_service.py` |
| ElevenLabs | STT, TTS | `ally-ai-learn/app/stt/elevenlabs.py`, `app/tts/elevenlabs.py` |
| Sarvam | STT, TTS | `ally-ai-learn/app/stt/sarvam.py`, `app/tts/sarvam.py`, `ally-ai/.../sarvam_service.py` |
| Hume | TTS | `ally-ai-learn/app/tts/hume.py` |
| Anthropic | Character interview, builder, analytics agent | `ally-be` (`character_interview_messages` replays Anthropic history) |
| AWS | S3 recordings, SQS, CloudWatch audit logs | `infra`, `ally-be/src/aws/` |
| LiveKit | Real-time audio | `ally-be/src/livekit/`, `ally-ai-learn` |
| PostHog | Product analytics | `ally-web`, self-hosted per `infra/ansible/posthog.yml` |

**Gap.** §16 is permissive, so this is *not* a blocking problem today — which is exactly why it
gets neglected. Three concrete deficits: (a) there is **no sub-processor register** — the table
above had to be reconstructed by grepping three repos, and §11 obliges Ally to tell a data
principal who their data was shared with; (b) DPA coverage across these vendors is unverified,
and §8 requires a valid contract with each; (c) there is **no config-level kill switch** to
restrict a provider by country, tenant or data class, so a §16 notification naming any of these
providers' jurisdictions would require a code change under time pressure. Provider selection is
already config-driven (`languages.llm_provider_config`, `stt_provider_config`, and the
`factory.py` pattern in `ally-ai-learn`), so the mechanism to build on exists.

Self-hosting PostHog is a genuine advantage here and should be noted as such.

### 3.10 🟡 Audit coverage for compliance events

**Today.** `AUDIT_EVENTS` covers auth, calls, audio/S3 lifecycle, transcript access, summary
export, admin actions, impersonation, role changes and analytics-agent queries — 175 call sites
(`ally-be/src/audit/constants/audit-event.constants.ts`). The `ACCESS_TRANSCRIPT` and
`SUPER_ADMIN_IMPERSONATE` events in particular are the right instinct.

**Gap.** No event exists for any DPDP-specific action: consent granted, consent withdrawn,
notice version served, access request received or fulfilled, correction applied, erasure
requested or completed, retention sweep executed, breach declared, or grievance opened and
closed. These are the events a Board inquiry or an SDF audit will ask to see.

### 3.11 🔴 Significant Data Fiduciary readiness (§10, Rule 13)

**Today.** No DPO, no DPIA, no independent audit, no algorithmic due-diligence record, no
published grievance contact.

**Gap.** All five. Lead times are long — an independent auditor must be engaged, and a DPIA
requires the data map this document begins to assemble.

---

## 4. The action plan

### 4.1 Sequencing logic

Eight months, and the work is not parallelisable in the obvious way. Three constraints set
the order:

1. **Workstream A gates almost everything.** Consent records, erasure, breach enumeration and
   subject access all need a subject key for help-seekers. Until that data-model decision is
   made, four other workstreams are blocked. **It starts now.**
2. **Backend before clients.** Per `infra/CLAUDE.md`, deploying a client ahead of the API it
   depends on produces failures that look like client bugs and waste a day. Every consent and
   rights surface lands in `ally-be` first.
3. **Mobile has a long tail.** Released builds are frozen contracts and users linger on old
   versions. Mobile consent work must ship early enough for adoption to accumulate before
   13 May 2027 — treat the effective mobile deadline as **~February 2027**, not May.

The two questions in §5 that gate real engineering (Q1 role, Q3 children) should go to counsel
**this month**. Q3 in particular can expand or delete an entire workstream.

### 4.2 Workstreams

---

#### **Workstream A — Identity and consent foundation** 🔴 *Gates B, C, E, F*
**Repos:** `ally-be` · **Target:** design agreed by 30 Sep 2026, shipped by 30 Nov 2026

The load-bearing decision: **how does Ally identify a help-seeker?** Three options, for a
decision record rather than a drift:

- **A1 — Pseudonymous subject key.** Mint a `data_subject` row per help-seeker interaction,
  keyed on whatever identifier the channel provides (phone for telephony and WhatsApp, a
  counsellor-entered reference otherwise), with no requirement that it be resolvable. Gives
  erasure and access a target; leaves breach notification partly unsolvable where no contact
  exists. **Recommended** — it is the smallest change that makes the other rights expressible.
- **A2 — Full identity capture.** Collect contact details for every help-seeker. Makes every
  right implementable and is in direct tension with anonymous helpline access, which is a
  clinical and ethical feature, not an oversight. **Not recommended** without clinical input.
- **A3 — Tenant-as-fiduciary.** Ally holds no help-seeker identity and contractually places
  notification duties on the tenant. Depends entirely on Q1 and does not remove Ally's §8
  processor duties.

Then build, whichever is chosen:

- [ ] `data_subjects` table — pseudonymous subject key, channel, optional contact, tenant.
- [ ] `consent_records` table — subject, purpose (enum: `RECORDING`, `TRANSCRIPTION`,
      `AI_SUMMARISATION`, `VECTOR_EMBEDDING`, `ANALYTICS`, `MODEL_IMPROVEMENT`), notice version,
      language, `granted_at`, `withdrawn_at`, mechanism, and an evidence artefact.
- [ ] `notice_versions` table — versioned notice text per language, so an acceptance points at
      immutable content rather than at whatever the page says today.
- [ ] Backfill and deprecate `users.termsAndAgreementApproved`. Per the platform's own
      hard-won lesson, **be lenient**: treat a missing consent record as "needs re-consent",
      never as an auth failure. A strict check here is how a compliance change becomes a login
      outage.
- [ ] Link every session, chat, recording and custom-field row to its subject key.
- [ ] **Stacks pass required** on the consent-purpose taxonomy and the help-seeker consent UX
      before implementation.

---

#### **Workstream B — Notice and consent surfaces** 🟡
**Repos:** `ally-web`, `ally-mobile`, `ally-be` · **Target:** web 31 Dec 2026, mobile 28 Feb 2027

- [ ] Rewrite the notice against Rule 3's itemisation; publish as versioned content served by
      `ally-be`, not as hardcoded client copy, so a notice update does not require an app release.
- [ ] Add the grievance contact and Board complaint route to every notice surface.
- [ ] Translate into every Eighth Schedule language Ally ships. **Verify rendering on a real
      Android device per the Indic-glyph gotcha** — a blank notice is a compliance failure that
      looks like a font bug.
- [ ] Replace the single accept-all gate with granular, purpose-level consent; unbundle optional
      purposes (analytics, model improvement) from service delivery.
- [ ] Build consent withdrawal reachable in the same number of taps as granting it (§6's
      "same ease" is testable — write the test).
- [ ] Re-consent flow triggered by notice version change, tolerant of old mobile builds.
- [ ] Replace the verbal help-seeker gate with a recorded consent artefact — for telephony, the
      recorded consent turn itself is the natural evidence.
- [ ] **Stacks pass required** on all consent copy, granularity and withdrawal placement.

---

#### **Workstream C — Data-principal rights API** 🔴
**Repos:** `ally-be`, `ally-web` · **Target:** 31 Jan 2027

- [ ] `GET /me/data-summary` (§11) — processing summary, purposes, and the sub-processor list
      from Workstream G.
- [ ] `POST /me/data-export` — async job producing a machine-readable export.
- [ ] `POST /me/corrections` (§12).
- [ ] `POST /me/erasure` (§12) — the request intake; execution is Workstream D.
- [ ] `DELETE /me` — account deletion. **This does not exist today at all.**
- [ ] `POST /me/nomination` (§14).
- [ ] Grievance intake with a tracked response clock and SLA reporting (§13).
- [ ] Admin console screens for servicing requests on behalf of help-seekers who have no login.
- [ ] Audit events for every one of the above (Workstream F).

---

#### **Workstream D — Retention and cross-store erasure** 🔴
**Repos:** `ally-be`, `ally-ai`, `infra` · **Target:** 31 Mar 2027

- [ ] **Generalise `WhatsAppRetentionService`** into a platform retention framework. Keep its
      design choices deliberately: configurable window with explicit off switch, batched writes,
      idempotent selection, blank-in-place to preserve aggregates, info-level logging. Register
      each personal-data store as a policy rather than writing a new sweep per module.
- [ ] Set and document a retention period per store in the §3.4 table — including an answer for
      `learner_supervisor_memory`, whose migration comment currently records the open question.
- [ ] 48-hour pre-erasure notice mechanism (Rule 8).
- [ ] **Erasure orchestrator** fanning out to Postgres, Weaviate (`delete_by_filter` — the
      primitive is already there and already refuses match-everything), S3, Redis and in-flight
      SQS, with a completion receipt per store. Prefer **crypto-shredding** — destroying the
      per-subject key — where hard deletes would break referential integrity or rewrite
      historical aggregates.
- [ ] Decide, per table, whether `deleted_at` soft deletes are erasure or tombstones. Most are
      tombstones today and do not satisfy §12.
- [ ] S3 lifecycle policies in `infra`, matching the Postgres windows.
- [ ] Lower SQS retention on the WhatsApp inbound queue, per the exposure its own producer
      documents.

---

#### **Workstream E — Breach detection and notification** 🔴
**Repos:** `ally-be`, `infra` · **Target:** 31 Mar 2027

- [ ] `data_breach_incidents` table — discovery time, nature, extent, affected-subject query,
      Board notification timestamps, per-principal notification status.
- [ ] Affected-principal enumeration built on Workstream A's subject key. **Without A this is
      not buildable**, which is the clearest illustration of why A is first.
- [ ] Notification templates carrying every Rule 7 element: nature, extent and timing,
      likely consequences, mitigation taken, steps for the individual, and a contact who can
      answer questions — in the data principal's language.
- [ ] 72-hour runbook with named owners and an escalation path; rehearse it once before May 2027.
      An untested breach process fails at 2am, and the ₹200 crore head does not care that the
      code existed.
- [ ] Detection: alerting on anomalous bulk transcript access, failed authorisation spikes, and
      unusual analytics-agent queries — the surfaces that already audit-log but do not alert.

---

#### **Workstream F — Security safeguards and audit hardening** 🟡
**Repos:** `ally-be`, `ally-ai`, `infra` · **Target:** 31 Dec 2026 *(do the cheap ones now)*

Several items here are days of work against a ₹250 crore head of liability, and should not wait
for the plan to be approved:

- [ ] **Close the Weaviate plaintext hole.** Conversation content is encrypted in Postgres and
      plaintext in the vector store. Either encrypt the stored `message` property, store only
      the vector and a reference, or accept it with a documented compensating control — but
      decide it explicitly.
- [ ] **Verify the HIPAA backfill actually encrypted everything.** The migration returns
      plaintext on failure with only a `console.warn`; run a detection query across `messages`
      and `call_details` for unencrypted values before assuming coverage.
- [ ] **Make audit logging fail loudly.** Today `ENABLE_AUDIT_LOGS_TO_CLOUDWATCH=false` yields a
      silent no-op. Rule 6 requires logs: refuse to boot in production without a working audit
      sink, or alarm on it.
- [ ] **Set CloudWatch log retention to ≥1 year** in `infra` (Rule 6).
- [ ] **Set explicit S3 server-side encryption** on every upload path in `ally-be/src/aws/`, and
      a bucket default in `infra`. Do not rely on an unverified bucket policy.
- [ ] Extend encryption to `scenario_report_transcripts`, `wa_message.body`,
      `chat_custom_field_values`, and `audit_logs.ipAddress`.
- [ ] Add the DPDP audit events listed in §3.10.
- [ ] **Reconcile the two audit paths.** Declare one authoritative (or define what each owns),
      and make a write failure alarm rather than log-and-continue. Two audit implementations with
      unclear precedence is the first thing an SDF auditor will find.
- [ ] Key management review: `PHI_DATA_ENCRYPTION_KEY` is a single env-var key with no documented
      rotation. Crypto-shredding in Workstream D needs per-subject keys anyway — design them together.

---

#### **Workstream G — Processors, cross-border, and SDF readiness** 🟡
**Repos:** `ally-be`, `ally-ai`, `ally-ai-learn`, docs · **Target:** register 31 Oct 2026, SDF items 30 Apr 2027

- [ ] **Sub-processor register as a checked-in artefact**, generated from or validated against
      the provider factories, so it cannot drift from the code the way §3.9's table had to be
      reconstructed. §11 requires disclosing it to data principals.
- [ ] Verify DPA coverage for every processor in §3.9; close the gaps (§8 requires a contract).
- [ ] Per-provider data-flow documentation: what leaves India, for what purpose, retained how long
      by whom.
- [ ] **Provider geo-restriction config** — extend the existing `llm_provider_config` /
      `stt_provider_config` / `factory.py` pattern so a §16 notification is a config change, not
      an incident.
- [ ] Appoint an **India-based DPO** and publish the contact (§8, Rule 13).
- [ ] **DPIA template and first assessment** — this document is the input.
- [ ] Engage an **independent data auditor** (long lead time; start early).
- [ ] **Algorithmic due diligence record** for the live agent pipeline, addressing the documented
      known risks: STT confidence unusable for Indian languages, per-language provider variance,
      and guardrail behaviour with a distressed data principal.

---

#### **Workstream H — Children's data** 🔴 *Scope depends entirely on Q3*
**Repos:** `ally-be`, clients · **Target:** decision 30 Sep 2026, implementation 30 Apr 2027

- [ ] **Legal determination first (Q3).** Whether Rule 12's healthcare/educational exemptions
      cover Ally's deployments decides whether this workstream is a documentation exercise or a
      full verifiable-parental-consent build. Do not start engineering before the answer.
- [ ] If not exempt: age signal in the data model; verifiable parental consent per Rule 10
      (identity details reliably held, virtual token, or Digital Locker); and a hard block on
      tracking and behavioural monitoring for child accounts — which means auditing PostHog
      instrumentation and per-learner performance tracking against §9(3).
- [ ] If exempt: document the basis, the conditions relied on, and the controls that keep Ally
      inside them. An exemption you cannot evidence is not an exemption.

---

### 4.3 Timeline

| Month | Milestone |
|---|---|
| **Sep 2026** | Q1/Q3 to counsel. Workstream A design agreed. Cheap Workstream F items shipped. |
| **Oct 2026** | Sub-processor register. DPO appointed. Q4 (Consent Manager) decided. |
| **Nov 2026** | Workstream A shipped. Rule 4 live — Consent Manager position must be settled. |
| **Dec 2026** | Web notice and consent surfaces. Workstream F complete. |
| **Jan 2027** | Rights API (Workstream C). |
| **Feb 2027** | **Mobile consent shipped** — early, for adoption lead time. |
| **Mar 2027** | Retention framework and erasure orchestrator. Breach runbook rehearsed. |
| **Apr 2027** | DPIA, independent audit, algorithmic due diligence, children's-data implementation. |
| **13 May 2027** | **Statutory deadline.** |

Reserve April for slippage, not for starting things.

---

## 5. For counsel

Engineering has proceeded on the stated assumption in each case so that work is not blocked;
where an answer would change the design, that is flagged.

**Q1. Is Ally a data fiduciary, a processor, or both — and for which population?**
*Assumption:* fiduciary for all populations. *If wrong:* changes who notifies whom on breach and
who services rights requests; does not reduce the engineering scope materially.
**Gates:** Workstreams A, C, E.

**Q2. Can a counsellor's verbal consent, attested by a tap, ever satisfy §6?**
*Assumption:* no — a persisted artefact per data principal is required. *If wrong:* Workstream A
shrinks substantially. This is the highest-leverage question after Q3.

**Q3. Do Rule 12's healthcare/educational exemptions cover Ally's deployments, and are any
learners or help-seekers under 18?**
*Assumption:* not exempt; under-18 help-seekers occur. *If wrong:* Workstream H reduces to
documentation. **This is the most valuable question on the list** — a ₹200 crore head of
liability and an entire workstream turn on it. **Answer by 30 Sep 2026.**

**Q4. Must consent be obtained through a registered Consent Manager (Rule 4, live 13 Nov 2026)?**
*Assumption:* no — Ally obtains consent directly. *Decide before 13 Nov 2026.*

**Q5. Should Ally plan for Significant Data Fiduciary designation?**
*Assumption:* yes. *If wrong:* Workstream G's DPIA, independent audit and algorithmic
due-diligence items become optional — though all three are defensible practice regardless.

**Q6. What retention period applies to each store, and which Third Schedule classes apply to
Ally?** Needed to fill the §3.4 table. *Assumption pending an answer:* three years of
data-principal inactivity, aligned to the Third Schedule's specified classes.

**Q7. Are there conflicting retention obligations** — clinical record-keeping, tenant
contractual terms, or HIPAA where Ally serves US-adjacent deployments — that require retention
*beyond* DPDP erasure? Erasure duties yield to other legal retention requirements, and
engineering needs to know which rows are exempt before building the sweep.

**Q8. Does the platform's HIPAA posture create any conflict with DPDP erasure?** Both regimes
apply to some deployments and they pull in opposite directions on deletion.

---

## 6. What is already good

Worth stating plainly, because a gap analysis reads as though nothing works, and because these
are the foundations the plan builds on rather than around:

- **Application-level encryption of the most sensitive columns**, with a real backfill migration.
  Most platforms this size have not done this.
- **Multi-tenant isolation treated as a security property**, not a filter — `ally-be/CLAUDE.md`
  states that a query without tenant isolation is a data leak, not a bug.
- **A dedicated audit path** with 175 call sites, including transcript access and admin
  impersonation — the events that matter most in an inquiry.
- **`WhatsAppRetentionService`** is a well-reasoned retention implementation, and the pattern the
  rest of the platform should adopt.
- **`delete_by_filter`** in `ally-ai` is the correct erasure primitive, written defensively.
- **Provider selection is already config-driven**, which makes §16 geo-restriction tractable.
- **PostHog is self-hosted**, keeping product analytics out of a third-party processor.
- **A documented culture of leniency about values that can only narrow a match** — the
  institutional memory of a role change that broke login for everyone. That instinct is exactly
  right for consent enforcement, and §4.2's Workstream A depends on it.

---

## 7. Sources

- The Digital Personal Data Protection Act, 2023 (No. 22 of 2023) — Gazette
  `CG-DL-E-12082023-248045`, 11 August 2023.
  [MeitY copy](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) ·
  [India Code](https://www.indiacode.nic.in/handle/123456789/22037?view_type=browse)
- Digital Personal Data Protection Rules, 2025 — notified 13 November 2025.
  [PIB note](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf) ·
  [rule-by-rule text](https://dpdp.ind.in/rules.php)
- [AZB — phased rollout and compliance milestones](https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/)
- [Privacy World — Rules analysis](https://www.privacyworld.blog/2025/11/india-passes-the-digital-personal-data-protection-rules-ushering-in-a-new-digital-age-in-india/)
- [Rule 6 — reasonable security safeguards](https://www.dpdpa.com/dpdparules/rule6.html) ·
  [Rule 12 / SDF obligations](https://www.dpdpa.com/dpdparules/rule12.html)
- [Future of Privacy Forum — the Act explained](https://fpf.org/blog/the-digital-personal-data-protection-act-of-india-explained/)

Ally code references are cited inline throughout §3 and were read at commit
`HEAD` of each repo on 2026-09-02.
