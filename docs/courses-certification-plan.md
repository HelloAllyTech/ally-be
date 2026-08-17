# Ally as a Courses + Certification platform — implementation plan

**Date:** 2026-08-13 · **Status:** Draft for review · **Scope:** ally-be, ally-web (admin + helpline + web), ally-mobile

> **Cross-repo plan.** It lives in `ally-be` because the backend does most of the work, but it spans ally-web and
> ally-mobile too. **All paths below are relative to the `ally-code` workspace root** (`ally-be/src/...`,
> `ally-web/apps/...`), not to this repo. Nothing here is implemented yet — this is a plan, not a description of
> the system. Deliberately **not** on the public wiki: §1.1 discusses a legal contradiction in our own terms of use.

---

## 0. The finding that shapes everything

**Ally already is a courses app.** Track 2.0 — product name "Courses", code name `Track` — is shipped
end-to-end today:

| Layer | What exists |
|---|---|
| Authoring | `ally-be/src/track` — 8 entities, 12 admin routes, publish gating, structure validation, tenant assignment |
| Content | 6 item types: `ROLEPLAY`, `CASE`, `QUIZ`, `ARTICLE`, `VIDEO`, `JOURNAL` |
| Assessment | 7 quiz question types, deterministic autograder + Anthropic LLM grading for open-ended, pass score, attempt limits |
| Progression | `track-progress.service.ts` — sequential unlock, section/track completion, idempotent `completeItem` funnel |
| Learner web | `ally-web/apps/ally-helpline-dashboard` — catalog, overview, full-screen player, per-type players, quiz widgets |
| Learner mobile | `ally-mobile` — full parity (`CourseOverviewScreen`, `CourseItemPlayerScreen`, all 6 players, all quiz widgets) |
| Analytics | `GET /v1/tenant-analytics/course-usage`, `GET /v1/analytics/track-dropoff` |

**Certification does not exist.** A word-boundary search for `certificate|certification|certify|diploma|CEU|credentialing|accredit`
across all six repos returns exactly two hits, both prose: a seed fixture description, and — critically — the
helpline terms of use.

So this is not a rewrite. It is: (a) closing the gaps that keep Courses a *content catalog* rather than a
*curriculum*, and (b) building the credential layer from zero. The plan below is sized accordingly.

### The seam that is already cut for us

`ally-be/src/track/service/track-progress.service.ts:441-446` emits three events:

```ts
TRACK_EVENTS = {
  ITEM_COMPLETED:    'track.item.completed',
  SECTION_COMPLETED: 'track.section.completed',
  TRACK_COMPLETED:   'track.completed',
}
```

**Nothing in the repo subscribes to any of them.** `track.completed` is the natural issuance trigger for a
certificate, and it is already firing with the right payload (`userId, tenantId, trackId, trackEnrollmentId,
trackItemId, trackSectionId, itemType`). Phase 3 plugs into a socket that is already live.

---

## 1. Blockers to resolve before any code

### 1.1 The terms of use currently promise the opposite

`ally-web/apps/ally-helpline-dashboard/src/constants/user.ts:105` — the terms every learner accepts at login say
the product *"doesn't replace human-supervised training, provide certification, or qualify you for independent
practice."*

Shipping certification without changing this is a legal contradiction against text the user actively consented to.
This needs, before Phase 3 merges:

- Revised terms copy, legal-reviewed.
- A written statement of **what the certificate claims** — the single most important product decision here. The
  defensible claim is narrow: *"X completed course Y on date Z and passed its assessment at N%."* It is a record of
  training completed, not a licence, not accreditation, not a competency warrant, and not CEU credit.
- Re-consent handling for existing users, since the login flow already gates on a terms modal
  (see the `ally-local-counsellor-api-token` note).

### 1.2 Certify training, never outcomes

The tombstoned-but-still-authoritative Ally guidance (`wiki/product/gamification.md`, principle 2) is explicit:
never attach reward to a client's outcome — points on a distressed persona's "result" teach performance, not care.
A certificate is the heaviest reward the product can issue, so this binds hardest here. The credential attaches to
*completion plus assessed knowledge*, never to simulation "success", empathy scores, or client-outcome proxies.

### 1.3 Certification is a per-tenant capability

Same source, principle 9: some organisations will not want it at all, and a tenant that has one must control what
it says. Use the existing `Preference` recipe (org-level boolean, no migration — see the
`ally-per-tenant-toggle-preference-recipe` pattern), gated as `tenant toggle AND permission`.

### 1.4 Non-goals for v1 — state them now

Out of scope, deliberately: CEU / accredited credit (requires an accrediting body), SCORM / xAPI import, external
LMS integration, webcam or ID-verified proctoring, and auto-posting to LinkedIn. **But** design the credential
payload to be Open Badges 3.0 / Verifiable Credentials-shaped so v2 interoperability is a mapping, not a rewrite.
Carry `credentialType` and a nullable `accreditationBody` on the row from day one.

---

## 2. Strategic framing — what "turn into" means for the IA

`ally-web/apps/ally-helpline-dashboard/src/pages/learn/Learn.tsx` presents four **parallel** tabs:
`courses | cases | simulations | tracks`. That is a content catalog. A courses-and-certification product needs a
spine: *this is the programme you are on, here is your next step, here is what you earn at the end.*

**Recommendation:** make Courses the primary surface and demote the rest to secondary "free practice". This is
cheap because a course can already contain a roleplay (`TrackItemType.ROLEPLAY` → `scenarioId`) and a case
(`CASE` → `caseId`); the simulations and cases tabs are duplicate entry points into content a course can own.
Keep them reachable, stop making them co-equal.

Concretely: `Learn` becomes Courses-first with an enrolled-programme header, and `ContinueLearningCard` (already
built) is promoted to the dashboard's primary CTA. The existing `TabId.TRACKS` (scenario-paths, the *older*
pathways concept) should be evaluated for sunset — two competing "sequence of content" primitives
(`scenario_paths` and `tracks`) is the single biggest source of conceptual drag in this product.

This is a decision to take explicitly. Phases 1–5 below do not depend on it, but it is what actually turns Ally
into a courses app rather than an app that has courses.

---

## 3. Gap analysis

### Courses half — what's missing for a credible LMS

| Gap | Evidence | Why it blocks certification |
|---|---|---|
| **No admin assignment** | `POST tracks/:trackId/enroll` is learner self-service only; `tenant-analytics.dto.ts:355` notes "Track 2.0 has no per-learner 'assigned but not started' event" | You cannot run a compliance programme, set a due date, or report "who hasn't started" |
| **No course versioning** | `PUT tracks/:id/structure` 409s once learners enrol (`track.service.ts:254`) — the only defence against content drift is *refusing to edit* | A certificate must state which version it certified. Today courses are frozen-on-enrolment, which is a dead end for a living catalog |
| **Only sequential progression** | `TrackProgressionMode` and `TrackSectionUnlockRule` each have exactly one value | Fine for v1; the enums are already extension points |
| **No prerequisites between courses** | No `track` → `track` dependency | Certification programmes are usually multi-course |
| **Non-roleplay items don't count toward practice minutes** | `community.event.consumer.ts:229` credits only `SCENARIO_SESSION_ENDED` | Learner effort on articles/quizzes/journals is invisible to streaks and badges |
| **No transcript** | — | The learner-facing record a credential hangs off |

### Certification half — all of it

No certificate entity, table, module, endpoint, template, PDF, or UI.

### Supporting infrastructure — what we have and what's missing

| Need | Status |
|---|---|
| S3 upload/presign | ✅ `s3.service.ts` is comprehensive; `track-media.service.ts` is the pattern to copy |
| Email | ⚠️ `ses.service.ts` uses `SendEmailCommand`, **no attachment support**, and there is no template engine anywhere (bodies are inline template literals) |
| PDF **generation** | ❌ `pdfjs-dist` is present but read-only, for text extraction. No pdfkit, pdf-lib, puppeteer, sharp, canvas, or qrcode |
| Scheduled jobs | ✅ `streak-reminder-scheduler-registration.service.ts` is the pattern for expiry sweeps |
| SQS | ✅ already wired (localstack locally) for async PDF rendering |
| Localisation | ✅ `translations` jsonb on tracks/sections/items/badges — certificates must follow |

**Two consequences to design around:**

1. **Email a link, never an attachment.** SES here cannot attach files without moving to raw MIME. This is also the
   better design — a verifiable URL beats a PDF in an inbox, and it can show revocation status.
2. **No headless Chrome.** `ally-be` runs an amd64 image under Rosetta (~150s cold start per the workspace CLAUDE.md).
   Adding puppeteer/chromium to that container is a serious operational regression. **Use `pdf-lib`** — pure JS, no
   native deps — drawing positioned text over a designer-supplied background image. Template design iterates as an
   image asset, not as HTML/CSS.

---

## 4. The plan

Five phases, ~13 PRs. Phases 1 and 2 are prerequisites for 3. Phase 4 and 5 can slip without breaking anything.

Migration numbering below starts at **`1904000000000`** — correct as of 2026-08-13, and **almost certainly stale by
the time you read it.** Other work lands migrations continuously: this plan was first drafted against `1898000000000`
and that prefix was taken *twice* within the same day (`1898000000000-CreateBugFindings.ts` and
`1898000000000-addNotApplicableGoalsToScenarioSessionDetails.ts` are both on disk, a live collision). Always re-check
`ls src/database/migrations | sort | tail` immediately before authoring, and see the `ally-migration-rename-collision`
note if a renumber bites locally. Treat the numbers below as ordering, not as literal values.

---

### Phase 1 — Course foundations (3 PRs)

#### PR 1.1 — Explicit assignment and due dates

Turns implicit tenant-wide availability into a tracked assignment, which is what makes every completion metric and
every certification programme meaningful.

- **New table** `track_assignments` (migration `1904000000000`):
  `id, trackId, userId, tenantId, assignedBy, assignedAt, dueAt (null), status (ASSIGNED|IN_PROGRESS|COMPLETED|OVERDUE), source (SELF|ADMIN|GROUP), deletedAt`.
  Unique `(trackId, userId) WHERE deletedAt IS NULL`.
- **Endpoints** on `track-admin.controller.ts`:
  `POST v1/learn/admin/tracks/:id/assignments` (bulk, accepts `userIds[]` or a group), `DELETE .../assignments/:userId`,
  `GET .../assignments` (paged, filterable by status).
- Self-enrolment continues to work and writes `source = SELF` — do not break the existing idempotent
  `POST tracks/:trackId/enroll`.
- **Permissions:** `assign:track` (tenant admin), `view:track-assignments`.
- Learner catalog shows assigned courses first, with due date; overdue is stated, never punished
  (gamification principle 4 — no lost ground).
- **Tests:** assignment idempotency, dueAt nullability, tenant isolation, self vs admin source.

#### PR 1.2 — Course versioning

Prerequisite for honest certificates. Without it, "certified against course Y" is unfalsifiable once Y changes.

- **New table** `track_versions` (`1904000000001`):
  `id, trackId, versionNumber (int), publishedAt, publishedBy, snapshot jsonb, changeNote, deletedAt`.
  `snapshot` holds the full section/item tree at publish time.
- `tracks.currentVersionId` added; `track_enrollments.trackVersionId` added (backfill existing rows to a
  version 1 snapshot generated at migration time).
- Publishing an ACTIVE track writes a new version row. **This lifts the 409 on structure edits**
  (`track.service.ts:254`): editors can now change a course while learners are mid-flight, because enrolments are
  pinned to a version.
- Learners in flight stay on their pinned version; a "new version available" prompt offers migration, never forces it.
- **Risk:** this is the most invasive PR in the plan — it touches the read path of every learner endpoint. It earns
  its own release and its own soak period.

#### PR 1.3 — Learner transcript + effort credit

- `GET v1/learn/me/transcript` — every enrolment with status, score, completion date, assignment source, and
  (post-Phase 3) credential.
- Credit non-roleplay item completion toward `user_daily_scores`: add a listener on `TRACK_EVENTS.ITEM_COMPLETED`
  that emits the existing `LeaderboardActionEvent.MINUTES_PLAYED_UPDATED` using
  `TrackItem.completionCriteria.minDurationSeconds` (or a per-type default) as the credited effort. This is the
  first subscriber to the track event bus and validates the seam Phase 3 depends on.
- **Gaming vector to instrument** (gamification principle 10): article items credit time on a `minReadSeconds`
  floor, so a learner can bank minutes by opening and idling. Log credited-vs-elapsed ratio and watch it.

---

### Phase 2 — Assessment worth certifying (3 PRs)

#### PR 2.1 — Assessment mode on quizzes

**Design decision: do not add a `TrackItemType.ASSESSMENT`.** A new item type means new player code in
`ally-web` *and* `ally-mobile` (they mirror each other file-for-file), new editors in admin, and three enum
migrations. Instead extend `QuizSettings` with `mode: 'practice' | 'assessment'`. The existing `QuizItemPlayer`
branches on it for exam chrome. One backend change, two small client changes, no schema churn.

New `QuizSettings` fields (all optional, all defaulting to today's behaviour):

```ts
mode: 'practice' | 'assessment'   // default 'practice'
drawCount?: number                // sample N of M questions per attempt
timeLimitMinutes?: number
cooldownHours?: number            // minimum wait between attempts
allowBackNavigation?: boolean     // default true; false for assessment
showExplanations: 'never'         // enforced for assessment mode
```

- **Question bank sampling:** `QuizContent.questions` is already an array. Draw `drawCount` of them with a
  per-attempt seed; persist the drawn ids on the attempt row so regrade and review are reproducible.
- **Time limit:** server-side only. `track_item_progress.startedAt` already exists; validate submission within
  `timeLimitMinutes` plus a grace window, and state the grace in the API contract rather than leaving it implicit.
- **Cooldown:** enforced alongside the existing `maxAttempts` gate (`track-quiz.service.ts:81`).
- Migration: none (jsonb).
- **Tests:** sampling determinism per seed, time-limit boundary and grace, cooldown rejection, back-navigation lock.

#### PR 2.2 — Grading integrity for certification-bearing assessments

This is the judgement call with the most at stake. Today `passed = scorePct >= passScore`
(`track-quiz.service.ts:259`), and open-ended questions are scored by an Anthropic call
(`track-quiz-llm-grader.service.ts`). A model deciding, unreviewed, that someone earns a credential violates the
principle Ally already wrote down for itself: *a model output is a proposal until a person accepts it*
(`wiki/product/ai-product-patterns.md`, principle 1). Stacks corroborates the general form — combining automated
evaluation with expert review of sampled outputs, and using those reviews to calibrate the automated grader
(Stacks: *Human-in-the-loop validation for agent output verification*).

**Rule:** an assessment whose result issues a credential must satisfy one of:

- **(a) Deterministic-only** — restricted to `mcq_single`, `mcq_multi`, `true_false`, `ordering`, `matching`,
  `fill_blank`. The autograder is exact; no model touches the pass decision. *This is the v1 default and the path
  of least risk.*
- **(b) LLM-assisted with a human boundary review** — open-ended allowed, but any attempt landing within a
  configurable band of the pass mark (default ±10 points) enters a review queue and the credential waits. Reviewer
  decisions are stored and sampled back as calibration data for the grader prompt.

The publish validator (`track-structure.validator.ts`) rejects a certification-bearing assessment that contains
open-ended questions while the tenant has not enabled (b). Every certificate records which mode graded it
(`gradingMethod`), so the claim is always traceable.

- **New table** `assessment_review_queue` (`1904000000002`) for path (b):
  `id, trackQuizAttemptId, tenantId, status (PENDING|APPROVED|REJECTED), reviewerId, reviewedAt, reviewerNotes, originalScorePct, finalScorePct, deletedAt`.
- **Permissions:** `review:assessment`, `view:assessment-reviews`.
- **Failure handling** (ai-product-patterns principle 5): a *failed grading run* and an *ungradable answer* are
  different states with different copy. The existing `PENDING_GRADING` + `/regrade` path already models this —
  extend it, don't replace it.

#### PR 2.3 — Item analysis

Attempts already store per-question grading, so this is nearly free and it is the highest-value thing you can build
for content quality: a question everyone fails is usually a broken question, not a hard one.

- `GET v1/learn/admin/tracks/:id/assessment-analysis` — per question: attempts, correct rate, mean points,
  discrimination (top-third vs bottom-third correct rate), mean time.
- **Suppress below a minimum group size** — in a small tenant, per-question analysis over five learners
  re-identifies individuals. This is the existing Ally rule for tenant-isolated metrics; apply it here and state
  the suppression on the surface rather than silently omitting rows.

---

### Phase 3 — The credential (4 PRs)

#### PR 3.1 — Certificate data model and issuance

**`certificates`** (migration `1904000000003`):

```
id                  uuid pk
serial              varchar unique      -- human-readable, e.g. ALLY-2026-7F3K-92QD
verificationCode    varchar unique      -- unguessable, public lookup key (ULID)
userId              uuid
tenantId            uuid
trackId             uuid
trackVersionId      uuid                -- what was actually certified (Phase 1.2)
assessmentAttemptId uuid null           -- track_quiz_attempts.id
status              ISSUED | EXPIRED | REVOKED | SUPERSEDED
credentialType      COMPLETION | ASSESSMENT   -- extension point for accredited types
accreditationBody   varchar null              -- always null in v1
issuedAt            timestamptz
expiresAt           timestamptz null
revokedAt / revokedBy / revocationReason
scorePct            numeric null
passScoreAtIssue    numeric             -- provenance: pass marks change
gradingMethod       DETERMINISTIC | LLM_ASSISTED | HUMAN_REVIEWED
gradedByModel       varchar null        -- provenance: models change under you
recipientNameSnapshot   varchar         -- a later rename must not rewrite history
courseTitleSnapshot     jsonb           -- per-locale, mirrors the translations pattern
templateId          uuid null
pdfS3Key            varchar null
metadata            jsonb
deletedAt
```

Unique partial index `(userId, trackId, trackVersionId) WHERE status <> 'REVOKED' AND deletedAt IS NULL` —
this is the idempotency guarantee for the event consumer.

The snapshot columns are not denormalisation for speed; they are the provenance rule from
`ai-product-patterns` principle 2 — *pin the provenance on the artefact, not the run*. A certificate read a year
later must still state what it certified, at what pass mark, graded how.

**`certificate_templates`** (`1904000000004`):
`id, tenantId (null = global default), name, backgroundImageUrl, fields jsonb (positioned text boxes with font/size/colour/alignment), signatoryName, signatoryTitle, signatureImageUrl, status DRAFT|ACTIVE, isDefault, translations jsonb, deletedAt`.

**Course config** — add `tracks.certificationConfig jsonb` (no new table):
`{ enabled, assessmentItemId, passScore, validityMonths (null = never expires), templateId, requiresAllItems }`.

**Issuance consumer** — `src/certificate/consumer/certificate-issuance.consumer.ts`, `@OnEvent(TRACK_EVENTS.TRACK_COMPLETED)`.
Guards, in order: tenant certification toggle ON → `certificationConfig.enabled` → designated assessment passed at
≥ `passScore` → no pending human review → all required items complete → no existing non-revoked certificate for
`(user, track, version)`.

**The certificate row is the credential; the PDF is a rendering of it.** Issue the row synchronously, enqueue PDF
generation to SQS. If rendering fails the credential still exists, and the UI says "your certificate PDF is being
prepared" — never "no certificate". This is the empty-vs-broken distinction (ai-product-patterns principle 5)
applied to an artefact people will screenshot.

**Permissions:** `view:certificates` (learner, self), `view:tenant:certificates` (org admin),
`view:admin:certificates`, `revoke:certificate`, `edit:certificate-template`.
⚠️ **After the permission migration, flush the prefixed Redis `*group:permissions:*` / `*user:groups:*` cache**
(30-min TTL) or every new route 403s — see the `ally-be-permission-cache-bust` note.

#### PR 3.2 — PDF rendering

- Add **`pdf-lib`** (pure JS — no chromium, no native build, safe in the Rosetta amd64 container).
- `CertificatePdfService`: fetch template background from S3, draw positioned fields from `template.fields`,
  embed a QR code to the verification URL (add `qrcode` — also pure JS), write to the **private** learn-media
  bucket under `certificates/{tenantId}/{certificateId}.pdf`, store the key.
- Downloads go through a presigned GET (600s, matching the `track-media.service.ts` convention), never a public
  object URL. The certificate is a named personal record; the *verification page* is the public surface, not the file.
- Render in the learner's locale using `courseTitleSnapshot` and the template's `translations`.
- **Tests:** golden-file byte comparison is brittle for PDFs — assert on extracted text instead, using the
  `pdfjs-dist` extractor already in the repo (`src/knowledge-base/extractor/pdf.extractor.ts`). Nice symmetry:
  the existing read-only PDF capability becomes the test oracle for the new write path.

#### PR 3.3 — Public verification

- `GET v1/public/certificates/:verificationCode` — unauthenticated, rate-limited, returns the **minimum** that
  makes verification meaningful: recipient name, course title, issue date, expiry, status, issuing organisation.
  No email, no user id, no tenant internals, no score by default (score disclosure is a per-tenant template option).
- Public page lives in **`ally-web`** (the Next.js app at :3000) at `/verify/:code` — it is the only public-facing
  app and currently holds almost nothing. Shape the JSON response Open Badges 3.0-compatible now so a future
  `/verify/:code.json` content-negotiated response is a serializer, not a migration.
- Revoked and expired states are shown plainly and differently: revoked is a negative assertion
  ("this credential was revoked on <date>"), expired is a neutral one ("valid until <date>; renewable").
- **Security:** unguessable ULID (not the serial, which is human-typable and therefore enumerable), per-IP rate
  limit, and no timing difference between "not found" and "revoked".

#### PR 3.4 — Learner and admin surfaces

**Learner (helpline dashboard + later mobile):**
- `/credentials` — "My Credentials", with expiry status and renew path.
- Certificate detail: preview, download, copy verification link.
- Course completion: `CelebrationOverlay` already exists in `track-player/components/`. Extend it with the
  certificate reveal — but **restrained**, not confetti. Gamification principle 6 is about proportionality, and
  a certificate for a course on suicide intervention or child protection deserves a dignified reveal, not
  fireworks. Muted by default; there is no good reason to make celebration intensity configurable per course.
- Every credential answers "why did I earn this" and "how do I keep it" in one sentence each
  (gamification principle 5).

**Admin dashboard:**
- Certification section in `CreateTrack` settings — enable, pick the assessment item, pass score, validity, template.
  The picker only offers quiz items in `mode: 'assessment'`, and states why when none exist.
- Template editor (upload background, position fields, live preview).
- Org certificate registry with CSV export and revocation (reason required).
- Add a Certificates tab to `OrganizationDetail` behind the existing `FeatureToggleKey.ORG_DETAIL_CONTENT_TABS`
  pattern.
- ⚠️ Admin track routes are currently gated on `Permissions.EDIT_EVENT` (`RouteLayout.tsx:285-300`) rather than a
  track permission. Fix that while here — and gate on the permission union, reading `roles[]`, never the collapsed
  `role` (`ally-role-gating-permission-union`, `ally-consumer-app-admin-link`).
- Add tooltips to non-obvious controls per the admin convention in `ally-web/CLAUDE.md`.

---

### Phase 4 — Lifecycle (2 PRs)

#### PR 4.1 — Expiry, recertification, reminders

- Nightly job (pattern: `streak-reminder-scheduler-registration.service.ts`) flips `ISSUED → EXPIRED` past `expiresAt`.
- **Expiry never removes the credential.** It stays in "My Credentials", visibly expired, with a renew action.
  Gamification principle 4 — make it impossible to lose ground you earned — applies with more force to a
  certificate than to a streak.
- Renewal within a grace window (default 90 days pre-expiry) re-runs the assessment only; past it, the full course.
  New certificate row; the old one becomes `SUPERSEDED` and stays visible with its original dates.
- Reminders at 60 / 30 / 7 days via the existing SES sender — a **link**, not an attachment.
- **New:** email templating. Three inline template literals is already at the edge of tolerable
  (`notification/service/email.service.ts`); certificate issuance, expiry warning, and revocation notice make six.
  Introduce a minimal template mechanism in this PR rather than a seventh literal.

#### PR 4.2 — Badges, streaks and analytics integration

- Extend `BadgeCategory` (currently `SIMULATION_MINUTES | ACTIVE_DAY_STREAK | COMMENTS_REACTIONS_GIVEN |
  COMMENTS_REACTIONS_RECEIVED`) with `COURSE_COMPLETED` and `CERTIFICATION_EARNED`, and subscribe
  `badge.event.consumer.ts` to `TRACK_EVENTS` — it listens to review, leaderboard and role events today and to no
  track event at all.
- Analytics: certification rate per course, time-to-certify (median), first-attempt pass rate, expiry-renewal rate.
  Extend the existing `CourseUsageRowDto` rather than adding a parallel endpoint.
- Charts follow the existing Carbon rules — mind the 14-char tick-label truncation
  (`ally-carbon-tick-label-14-char-truncation`) and the overflow behaviour.

---

### Phase 5 — Mobile parity + reporting (1 PR)

`ally-mobile` mirrors `ally-web` file-for-file (`src/services/coursesApi.ts` is commented as mirroring
`api/tracks.ts`). Port: credentials list, certificate detail with native share sheet, assessment-mode player chrome,
certificate reveal on completion. The PDF opens in the system viewer via the presigned URL — do not build an
in-app renderer.

Org reporting: scheduled certification-status export for compliance officers.

---

## 5. Sequencing and effort

| Phase | PRs | Blocks | Rough size |
|---|---|---|---|
| 0 — decisions, legal copy | 0 | everything in Phase 3 | days, mostly not engineering |
| 1 — assignment, versioning, transcript | 3 | Phase 3 | **large** — 1.2 is the riskiest change in the plan |
| 2 — assessment mode, grading integrity, item analysis | 3 | Phase 3 | medium |
| 3 — credential, PDF, verification, surfaces | 4 | Phase 4, 5 | large |
| 4 — lifecycle, badges, analytics | 2 | — | medium |
| 5 — mobile, reporting | 1 | — | medium |

**Critical path:** 1.2 (versioning) → 2.1 (assessment mode) → 2.2 (grading integrity) → 3.1 (issuance) →
3.2/3.3 (PDF, verification) → 3.4 (surfaces).

**Shippable earlier than the full path:** Phase 1 alone materially improves the courses product (assignment and
due dates are what tenant admins ask for first), and it is independently valuable if certification slips.

---

## 6. Risks and known traps

| Risk | Mitigation |
|---|---|
| **Terms of use contradict the feature** | Blocker. Resolve in Phase 0 before 3.1 merges |
| **Course versioning touches every learner read path** | Its own PR, its own release, soak before Phase 3 |
| **A model silently awards a credential** | PR 2.2 — deterministic-only default, human boundary review for LLM-assisted, `gradingMethod` recorded on every certificate |
| **Certificate claims more than it can defend** | Fixed, legal-reviewed claim string; no competency or licensure language |
| **Public verification endpoint is a new attack surface** | ULID (not serial), rate limit, minimal payload, uniform not-found/revoked timing |
| **Chromium in the Rosetta amd64 container** | `pdf-lib`, not puppeteer |
| **Redis permission cache after the permissions migration** | Flush `*group:permissions:*` / `*user:groups:*` — 30-min TTL, raw-SQL migrations cannot bust it |
| **Three clients mirror each other** | Assessment mode as a settings flag, not a new `TrackItemType`, keeps the blast radius to two small client diffs |
| **Migration prefix collisions** | Re-check `ls src/database/migrations \| tail` immediately before authoring; history already has three files at `1885000000000` |
| **`ally-be` pre-commit runs lint + full jest** | SIGTERMs at a 2-min Bash timeout with no commit made; scope-check then `--no-verify` |
| **`ally-web` husky pre-commit is red on master** | Pre-existing `ToggleButtonGroup` / `createSimulation` failures; `--no-verify` |
| **Two competing sequence primitives** (`scenario_paths` vs `tracks`) | Not created by this plan, but it makes every IA decision harder. Decide the sunset in Phase 0 |
| **Item-analysis re-identification in small tenants** | Minimum group size suppression, stated on the surface |

---

## 7. Stacks provenance

Six `search_chunks` queries were run across the task's distinct aspects — course structure and curriculum
sequencing, assessment design and mastery criteria, certification and credential motivation, learner progress and
completion rewards, gamification reward schedules, and instructional design scaffolding. Every hit returned from a
single AI-agent-engineering book at weak scores (0.33–0.48); none bears on course or certification product design.
One chunk was applied: *Human-in-the-loop validation for agent output verification* (Albada, §Best Practices), in
PR 2.2, for the general form of pairing automated grading with sampled expert review used to calibrate the grader.

Per the documented fallback for Ally-specific questions a general corpus has no reason to hold, guidance was taken
from the tombstoned `wiki/product/` pages, which remain the only written Ally-specific product rules on these
topics:

- `wiki/product/gamification.md` — principles 2 (never gamify the client's outcome), 4 (impossible to lose earned
  ground), 5 (one-sentence explainability), 6 (proportional celebration), 9 (per-tenant switch), 10 (instrument for
  gaming).
- `wiki/product/ai-product-patterns.md` — principles 1 (a model output is a proposal until a person accepts it),
  2 (provenance on the artefact), 5 (empty ≠ broken), 12 (meter every LLM call).

These are deprecated, not gates; where future Stacks guidance conflicts, Stacks wins.
