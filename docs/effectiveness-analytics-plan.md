# Measuring whether Ally works: effectiveness analytics plan

**Date:** 2026-10-04 · **Status:** Plan for a build session · **Scope:** ally-be (endpoints, SQL, chart registry) and ally-web (`apps/ally-admin-dashboard`, Analytics section)

> **Who this is for.** A Claude Code session (or an engineer) that will build the charts. It is
> written to be the only context that session needs besides the two repos. Read §0 to §5 before
> touching code; §6 to §8 are the specs; §9 is how to build them the way this codebase expects;
> §10 is what to ask Stacks first; §11 is what a human must decide.
>
> **Cross-repo plan.** It lives in ally-be because the backend does most of the work, like
> `docs/courses-certification-plan.md`. Paths are prefixed with the repo name.

---

## 0. The one-paragraph version

Ally's goal is that learners get better at 14 transcript-scorable helping competencies by
practising with AI clients and by taking courses. The admin console already carries 180
registered charts, and the "Helping skills" sub-tab is a serious, statistically careful
learner-outcome measure. So this plan is **not** "add an effectiveness dashboard from scratch".
It is four things, in priority order:

1. **Fix the ruler.** The existing "Skill growth" sub-tab and the Competency map plot
   `scenario_session_details.compositeScore`, which is the LLM judge's score of the **AI actor**
   against super-admin agent test cases. Its prompt says, verbatim, *"do NOT score the trainee"*.
   Those charts are presented as learner efficacy. Re-point or relabel them before building
   anything on top (§3.1, §7).
2. **Tell the chain story on one screen.** A new Highlights sub-tab, **Effectiveness**, that
   walks Reach → Dose → Learning → Transfer → Perception → Efficiency with one tile per link,
   each linking to the sub-tab that owns the detail (§6.A).
3. **Measure the curriculum.** Courses are the second half of the product promise and today the
   Curriculum sub-tab has four charts, none of which asks whether a course changes a skill.
   Course lift, quiz outcomes, roleplay gates, per-course progress curves (§6.C).
4. **Close the remaining gaps in the learning measure:** retention after a break, transfer to
   new and harder scenarios, scenario opportunity coverage, practice quality, convergence
   between rulers, segment equity, and time-to-competence (§6.B, D, F, G, I, J).

Two things need product work before they can be charted and are specified as dependencies, not
built here: a learner self-efficacy instrument (§6.H) and a human-rating sample for judge
validation (§6.J2).

---

## 1. What "effective" means for this product

### 1.1 The goal, stated precisely

**Learners improve, against their own starting point, on the 14 foundational helping skills that
can be observed in a transcript, and the improvement holds up outside the scenario it was learned
in.** The 14 are the FHS rubric minus non-verbal communication
(`ally-be/docs/foundational-helping-skills.md` §1, §2.2; keys in
`ally-be/src/foundational-skills/constants/helping-skills-rubric.constants.ts`):

| Tier | Skills |
|---|---|
| Engage | `verbal`, `confidentiality`, `rapport`, `feelings`, `empathy`, `harm` (safety-critical) |
| Understand | `functioning`, `explanation`, `family`, `coping`, `psychoeducation` |
| Support | `goals`, `hope`, `feedback` |

Two other "competency" lists exist and must not be confused with this one (doc §9):
the 15 **seeded roleplay competencies** in the `competencies` table (used to tag scenarios;
"Linking Emotions, Thoughts & Behaviours" is a different skill from `functioning`), and a
15-item list in an ally-ai prompt that nothing calls. When this plan says "competency" it means
an FHS skill unless it says "scenario competency tag".

### 1.2 Theory of change: the chain that has to hold

Effectiveness is a chain. Each link is a sub-goal with its own metric, and the product fails if
any link breaks, so the measurement has to cover every link, not just the last one.

| # | Link | Sub-goal | The question the chart must answer |
|---|---|---|---|
| L1 | Reach | Learners are onboarded and activated | Who starts, and how fast? |
| L2 | Dose | They practise enough, often enough, deeply enough | How much practice, how spaced, how deep? |
| L3 | Dose quality | A session is actually practice: the learner talks, the client stays in role, the scenario elicits the targeted skill | Did this practice exercise the skill it claims to? |
| L4 | Feedback loop | Feedback is grounded and gets acted on | Does an improvement named at session N show up at N+1? |
| L5 | Learning | Behaviour changes, per skill, against own baseline, scenario-independent | Are they better than they were? On which skills? |
| L6 | Curriculum | Courses and their components cause learning, beyond the practice they contain | Does completing a course move a skill more than practice alone? |
| L7 | Transfer and retention | The gain survives new scenarios, harder scenarios, and a break | Does it stick, and does it generalise? |
| L8 | Safety-critical | Harm assessment and confidentiality specifically | Are self-harm cues followed up? Is confidentiality promised without limits? |
| L9 | Perception | Learners feel more confident, and that confidence is calibrated | Do they think they improved, and are they right? |
| L10 | Efficiency and equity | Improvement per hour and per dollar; the same for every language, org, role | How much practice buys a point? For whom does it not work? |
| L0 | Validity | The rulers measure what they claim | Do the judges agree with humans and with each other? |

### 1.3 Why the chain matters more than the headline

A single "learners improve by X" number is what leadership asks for, and the Helping skills tab
already produces it with a confidence interval. But it cannot say *why* it moved or failed to
move, and this data has repeatedly produced composition artefacts that looked like findings
(`ally-be/docs/weak-metrics-queries.md`, "Segment, or you are measuring traffic mix"). The
chain lets a reader locate the broken link: plenty of practice but no learning points at content
or feedback; learning that vanishes after a break points at spacing; learning only in one
language points at the judge or the scenario mix.

---

## 2. What already exists, mapped onto the chain

The registry is `ally-be/src/analytics/constants/admin-analytics-chart-registry.constants.ts`
(served at `GET /v1/analytics/chart-registry`). Ids run to **AAQ-191**; new ids start at
AAQ-192 and append in on-screen order. Retired ids (011, 037–039, 070, 170, 175, 180, 182) are
never reused.

| Link | Covered today by | Gap |
|---|---|---|
| L1 Reach | Priority: AAQ-018/019/020/035 (new users, cumulative, new vs returning, activation funnel); Platform: 012–016, 021–025; Usage: 036 | None worth building |
| L2 Dose | Priority: 002, 026, 041; Usage: 040; Helping skills: 188 (practice depth); Orgs: 073/074 | Spacing between sessions |
| L3 Dose quality | Helping skills: 178 (learners with a chance at each skill); Actor quality, Drift, Language tabs (the AI side); 084 | Learner talk share and turns; opportunity coverage **per scenario**; scenario tag accuracy; state progression (query exists in the cookbook, no chart reads it) |
| L4 Feedback | Weak metrics: feedback groundedness; Helping skills: 169, 179, 190 (behaviours stopped/started) | Whether a named improvement is acted on |
| L5 Learning | **Helping skills 168–191** (paired start→now with bootstrap CIs, per skill, per behaviour, level mix, benchmark slope, precision, learner table); Skill growth 042–049 (**mis-pointed, see §3.1**) | Learner ordinal curve on a learner ruler; time-to-competence |
| L6 Curriculum | Curriculum: 050 (drop-off by item format), 052/053 (scenario usage); Platform: 031 (track funnel); tenant-analytics `course-usage` (tenant admins only) | Course lift, quiz outcomes, gates, per-course progress, knowledge vs skill |
| L7 Transfer | Helping skills: 189 (benchmark scenario before/after) | Retention after a break; new-scenario transfer; difficulty progression |
| L8 Safety | Helping skills: 185 (self-harm cues), 186 (confidentiality) | None; surface them on the scorecard |
| L9 Perception | Priority: 005, 156; Quality & sentiment: 055–062 (satisfaction) | Confidence / self-efficacy, calibration |
| L10 Efficiency | Unit economics 075–080; 157, 165 | Practice per point; cost per improved learner; segment equity |
| L0 Validity | Helping skills: 187 (precision; "human-rater agreement: not yet measured") | Convergence between rulers; human agreement |

### 2.1 Conventions already in force (inherit, do not reinvent)

These are the house rules the existing analytics code follows. Every new chart follows them.

- **Own-baseline, paired designs.** Compare a learner with their earlier self, never a month
  with another month (`skill-growth-analytics.dto.ts` header; FHS progress `FhsChangeDto`).
- **Survivorship control.** Any ordinal curve carries a fixed-panel series next to the
  all-comers series (`SkillGrowthOrdinalDto.experienced`).
- **Floors are server-side; counts travel, rates do not.** `minSampleSize` is echoed in the
  response, a suppressed cell returns `null` with `n`, and the client never re-derives the floor
  (`ally-web/.../types/analyticsTesting.ts:12-21`). `MIN_N_FOR_SCORE = 20`;
  `MIN_LEARNERS_FOR_SHARE = 5`.
- **Fixed axes** (`scoreDomain`) so a small wobble cannot fill the chart.
- **Judge-version pinning.** Scores are comparable only within one `(model, rubricVersion)`;
  never average across versions. FHS stores `rubricVersion` on every assessment.
- **Test tenants excluded, always**, via `excludeTestTenants*()` in
  `ally-be/src/analytics/util/test-tenant.util.ts`; tenant narrowing via `scopeToTenant*()`.
- **Countable sessions only:** `status='ENDED' AND eventStatus='COMPLETED'` plus
  `countableSessionPredicate()` (no `preview-%` / `seed-room-%` rooms), duration via
  `sessionDurationMsExpr()` (`session-eligibility.util.ts`).
- **Numerator and denominator kept separate; divide once at the end.** A zero denominator is
  "no data", never 0%.
- **All-time for ordinal x-axes.** Anything indexed by "the learner's Nth …" takes no range
  parameter, and the card says "all time" on its face.
- **Provenance on the card.** Every response carries `provenance`/`computedAt`; the card shows
  it via `buildSource()`.
- **Statistics helpers exist.** `paired-stats.util.ts` (paired bootstrap CI, sign test),
  `foundational-skills-progress.util.ts`, `foundational-skills-behaviour.util.ts`
  (Benjamini–Hochberg, ICC), `data-floor.util.ts`. Reuse them.
- **No pass/fail language** in learner-facing copy; admin surfaces may rank learners only for
  coaching, never as a leaderboard of skill (FHS doc §3.2, §10).
- **HIPAA.** No transcript text in analytics responses. FHS stores behaviour codes, never quotes.

---

## 3. Findings that change the plan

### 3.1 The "Skill growth" charts measure the AI, not the learner

Verified in this session by reading three places:

- `ally-ai-learn/app/core/scenario_session_evaluation/evaluator.py:67-109` builds the judge
  prompt: *"Turns labelled [user] are the trainee — do NOT score the trainee. Evaluate ONLY the
  actor's performance against each of the following superadmin-configured agent test cases."*
- `ally-be/src/learn/entity/scenario-session-details.entity.ts:70` stores that result as
  `compositeScore` (round of the mean of applicable `metrics`), and
  `scenario-session-evaluation.dto.ts` names the webhook `UpdateActorEvaluationDto`.
- `ally-be/src/analytics/repository/skill-growth-analytics.repository.ts:566,672`,
  `competency-map-analytics.repository.ts:224` and `highlights-analytics.repository.ts:488`
  all read `d."compositeScore"`.

So AAQ-042 "Learners improving", 043, 044, 046 "Score by Nth evaluated session", 047
"Learners improving, holding steady or declining", 048 "Competency map — volume against
proficiency" and 049 are, as built, curves of **actor quality** indexed by learner session
count. `ally-be/CLAUDE.md` already warns that `compositeScore` is "the judge's actor-evaluation
composite" and that only `scenario_sessions.score` is the learner's; the charts predate that
note. The same number also reaches learners: `TrackProgressDashboard.averageCompositeScore` and
`roleplaySessions[].compositeScore` in the helpline Course progress page, and possibly
`avgScore` in `tenant-analytics` learner-usage and course-usage (the build session must verify
which column those read).

**The build session re-confirms this before acting** (grep `compositeScore` across
`ally-be/src/analytics/repository`, read the evaluator prompt) and then applies §7.

### 3.2 There is no per-session, per-competency learner score

The only per-skill learner scores come from the FHS judge, which scores 5,000-character
**cuts** of a learner's own speech. Cuts can span sessions and are attributed to a scenario only
approximately. Every chart that needs "the skill score for *this* session" must either use a
weaker per-session signal (§4, R2–R4) or accept cut-level attribution with the limitation stated
on the card.

### 3.3 Courses do not know which competency they teach

Nothing in `ally-be/src/track` refers to competencies. A track reaches a skill only through its
roleplay items' scenarios (`track_items.scenario_id → scenarios.competencyIds`). Course lift
therefore starts on the **composite** and on the tiers, with a derived "skills this course's
roleplays are tagged with" set as a secondary cut. A `competencyIds` column on `tracks` (or
`track_items`) is a schema decision for humans (§11).

### 3.4 No self-report instrument exists

`scenario_session_feedbacks.rating` (1–5, CSAT) is the only structured learner opinion. There
is no confidence, self-efficacy, or pre/post self-assessment. Likert quiz questions exist but
are untyped and untied to skills. L9 cannot be charted until an instrument exists (§6.H).

### 3.5 The population is small

About 90 active learners; with the n=20 floor, only the first few FHS cuts clear it, and an
earlier dose–response chart (AAQ-182) was retired because 3 of 4 bands were withheld. Every
chart below states the population it needs and what it shows below that population. Prefer a
chart that honestly says "not yet measurable, n = 12 of 40 needed" over one that is silently
empty, and prefer paired/own-baseline designs, which need fewer learners than between-group
comparisons.

---

## 4. The rulers: learner signals available today

| Id | Signal | Where | Scale | Trust | Use for |
|---|---|---|---|---|---|
| R1 | FHS skill levels per cut | `foundational_skill_cuts` (`userId`, `cutIndex`, `tenant_id`, `sessionIds[]`, `startSessionId`, `closedSessionEndedAt`, `learnerChars`, `startsMidSession`, `endsMidSession`) + `foundational_skill_assessments` (`cutId`, `rubricVersion`, `status`, `compositeScore` 1–4, `hasUnhelpfulBehaviour`, `skillLevels{key:1-4}`, `verdicts[{skill, opportunity, level, observed[], notApplicable[]}]`) | 1–4 per skill, opportunity-gated | **Primary.** Scenario-independent, versioned, validated ticks | L5, L6, L7, L8, L10, L0 |
| R2 | Session score | `scenario_sessions.score` (sum of `scenario_session_events.score`; the learner meter runs −100..100) | Scenario-dependent | Comparable only **within one scenario version**. A 0 can mean "unresolved" (ally-ai-learn sends 0 when it cannot resolve) | Same-scenario repeat improvement (D4); gates (C5); calibration (D3) |
| R3 | Behaviour-instruction hits | `scenario_session_behavior_instructions` → `scenario_behavior_instructions.category` (SHOULD_DO / SHOULD_NOT_DO) → `scenario_behavior_instruction_behaviors.behaviorId` → `competency_behaviors.competencyId` | Counts per session per scenario competency tag | Live detection, depends on scenario config. Good for per-session, per-tag presence; not a level | Convergence (J1); competency map fallback (§7) |
| R4 | `skillCoverage` | `scenario_session_details.summary->'feedback'->'skillCoverage'` (3 categories 0–100; two label generations) | Coarse | LLM, unversioned | Convergence only |
| R5 | Quiz / annotation attempts | `track_quiz_attempts` (`trackItemId`, `userId`, `attemptNumber`, `scorePct`, `passed`, `grading[]`, `submittedAt`), `track_annotation_attempts` | 0–100 | Deterministic autograder + LLM for open-ended | Knowledge (C3, C4) |
| R6 | Session rating | `scenario_session_feedbacks.rating` 1–5, `tags[]` | Perception | Self-report, sparse | H2 |
| R7 | Transcript shape | `scenario_session_messages` (`senderId = -1` is the client; drop `metadata->>'utteranceKind'` in filler/interim) | Chars, turns, timestamps | Deterministic | Dose quality (G1) |
| R8 | Benchmark assessments | `foundational_skill_benchmark_assessments` (first vs latest on `scenarios.metadata.fhsBenchmark`) | 1–4 | Primary, whole-session | Already AAQ-189 |
| R9 | State progression | `scenario_session_turn_metrics.metadata` (`stateIndex`, `stateCount`, `stateIsTerminal`) | Per turn | Deterministic; absent in branching mode and before 2026-06-10 | D5 |
| R10 | Course progress | `track_enrollments` (`trackId`, `userId`, `tenantId` uuid, `startedAt`, `completedAt`, `completedItems`, `lastActivityAt`), `track_item_progress` (`status` LOCKED/UNLOCKED/COMPLETED, `startedAt`, `completedAt`, `score`, `attemptCount`), `track_items` (`type`, `scenario_id`, `completion_criteria{minScore,passScore,…}`), `scenario_sessions.trackItemProgressId` | Events | Deterministic | L6 |

**Scenario attribution for a cut (needed by D1, D2, F2, F3):** a cut is single-scenario when
`array_length(sessionIds,1) = 1`, or when every session in `sessionIds` has the same
`scenarioId`. Otherwise attribute to the session that contributed the most learner characters,
computed from `scenario_session_messages` between `(startSessionId, startMessageId)` and
`(endSessionId, endMessageId)`. Report the share of cuts that were single-scenario on the card;
if it is below ~60%, restrict the chart to single-scenario cuts and say so.

---

## 5. Measurement principles specific to this plan

1. **One ruler per claim, named on the card.** Every chart's `provenance.derivation` says which
   of R1–R10 it reads. A learner-outcome claim is made on R1 or R8 unless the card says why not.
2. **Observational, not causal, and say so.** Course lift compares learners with themselves
   before and after, with a practice-matched free-practice reference. The takeaway copy says
   "associated with", never "caused".
3. **Pin the judge.** Any chart on R1 filters `rubricVersion = FHS_RUBRIC_VERSION` and shows the
   version in the source line. If a second version appears in the data, show both as separate
   series, never pooled.
4. **Paired first.** Within-learner designs before between-group ones. Between-group cuts
   (language, org, worker type) are shown only with CIs and only above the floor.
5. **Every rate has its n on the card** and a "need N" message below the floor, using
   `ChartCard`'s `n`/`minN` props, not custom copy.
6. **Mix check travels with any trend.** A calendar trend on a learner ruler shows the segment
   mix (language, difficulty, scenario) in its expanded view, so a step can be checked against a
   composition change before it is believed.
7. **Safety metrics are internal.** Anything derived from unaudited judge coding of self-harm
   cues keeps AAQ-185's "share only privately with partners" note.
8. **No learner leaderboards.** Learner tables exist for coaching (flags, own-baseline change)
   and sort by change, not by level, matching AAQ-183.

---

## 6. The charts to build

Ids are provisional (`EFF-nn`). Assign `AAQ-192` onward at build time in on-screen order, add
each to the registry in the same PR as its card, and pass the literal id as `chartId`.

Each spec: **Question** · **Form** (Carbon chart via `chartKit.tsx` factories) · **Definition** ·
**Data** · **Floors and states** · **Caveat on the card** · **Endpoint**. Priority is P0–P3 and
maps to the phases in §8.

### 6.A Highlights → Effectiveness (new sub-tab): the chain on one screen

The sub-tab opens with a blurb (one sentence: "Does practice on Ally change how people help?
Each tile is one link in that chain; open the tile's tab for the detail.") and is built from
existing endpoints wherever a tile already has an owner. It is mostly composition, which is why
it is P0 despite being new.

**EFF-01 · The chain · KPI strip (`group`) · P0**
Eight `KpiTile`s in one row, each with `description` naming the owning sub-tab:

| Tile | Value | Source endpoint |
|---|---|---|
| Activated learners | learners with a first countable session, last 90d | `activation` |
| Measurable learners | learners with ≥ 2 scored cuts | `foundational-skills/progress` `depth` |
| Helping skills, start → now | panel composite change ± CI, "no detectable change" when CI spans 0 | `foundational-skills/progress` `summary.composite` (AAQ-168's number) |
| Learners beyond noise | improving / declining counts | `summary` behind AAQ-171 |
| Unhelpful behaviour, start → now | share change in points | AAQ-169's number |
| Course lift | composite change around course completion ± CI | **new** `curriculum/course-lift` (EFF-20) |
| Self-harm cues followed up | share followed up, with "internal" badge | `safety.selfHarm` (AAQ-185) |
| Practice per point | median cuts to reach Engage competence | **new** `foundational-skills/time-to-competence` (EFF-60) |

States: each tile loads independently; a tile whose endpoint is withheld shows `n` and "need
N". Caveat: the strip is a summary of other tabs' definitions; the tile description links the
reader there rather than restating the definition.

**EFF-02 · Where learners fall out of the chain · `FunnelBars` · P0**
Question: at which link does the population thin out?
Stages, all-time, distinct learners (non-test orgs, LEARNER role): signed up → first countable
session → second session → first scored cut → two scored cuts (measurable) → improving beyond
own noise band. Shares are server-computed. Data: `users`, `scenario_sessions`,
`foundational_skill_cuts/assessments`, and the trend classification already computed for
AAQ-181 (reuse its function; do not re-implement the band).
Floors: counts always shown; the last stage withheld below 20 measurable learners.
Caveat: "Improving" uses the Helping skills noise band; a learner with fewer than 4 cuts cannot
be classified and is counted in "two cuts" but not beyond.
Endpoint: `GET /v1/analytics/effectiveness/funnel?tenantId=`.

**EFF-03 · Effectiveness by segment · dot-and-whisker (`ChangeWhiskers`) · P1**
Question: does the start→now improvement hold for every language, org size, worker type and
difficulty mix, or is the headline one segment's?
Definition: the Helping skills panel's paired start→now composite change, computed per segment
with its bootstrap CI; segments: session language (`scenario_sessions.metadata->>'languageId'`
→ `languages`), learner `WorkerType` (where stored on the user/session; verify), org size band
(learners per tenant: 1–9 / 10–49 / 50+), course-enrolled vs free practice
(`track_enrollments` exists before the "now" window), majority scenario difficulty
(`scenarios.difficultyLevel` via cut attribution, §4). One whisker per segment value; coloured
only when the CI excludes zero; "withheld" rows below 20 learners listed with their n.
Caveat: segments are not independent (language and org overlap); read one dimension at a time;
a difference between segments is a hypothesis to check with the mix check, not a finding.
Endpoint: `GET /v1/analytics/foundational-skills/progress/segments?dimension=language|workerType|orgSize|course|difficulty&tenantId=`.
Expanded view: table with n, change, CI, up/down/tied per segment.

**EFF-04 · Dose–response: change against practice amount · scatter + fitted line · P3 (gated)**
Question: do learners who practise more improve more?
Definition: one point per panel learner: x = scored cuts (or practice minutes), y = own
first-half vs last-half composite change (the AAQ-171 quantity); least-squares line with its
slope CI; no banding (AAQ-182 was retired because bands went below the floor).
Floors: render only when ≥ 40 classified learners; below that show the "not yet measurable"
empty state with the count and the threshold, not an empty chart.
Caveat: more practice is self-selected; people who improve may keep going.
Endpoint: extend `foundational-skills/progress` with `learnersScatter[]` (no names; ids only).

### 6.B Highlights → Helping skills: additions to the learning measure

**EFF-10 · Learner ordinal curve on a learner ruler · `LineChart` · P1**
Question: the question AAQ-046 was meant to answer: does a learner's Nth unit of practice score
better than their first, with the AI actor held out of the number?
Definition: x = cut index 1..N; y = median composite (1–4) with IQR; two series, all-comers and
the fixed panel (survivorship control, exactly as `SkillGrowthOrdinalDto.experienced`). This
overlaps AAQ-172 (balanced panel, bootstrap band). Build it only if the Skill growth sub-tab is
retired rather than re-pointed (§7, decision 1); if Skill growth is re-pointed to R1, this *is*
that chart and keeps AAQ-046.

**EFF-11 · Skill retention after a break · grouped dot-and-whisker · P1**
Question: when a learner stops for two weeks or a month, do they come back at the level they
left?
Definition: for each learner and each consecutive pair of scored cuts (k, k+1) under the pinned
rubric, the gap = time between the end of the last session in cut k and the start of the first
session in cut k+1 that is not in cut k (`scenario_sessions.endedAt/startedAt` via
`sessionIds`). Bands: < 7 days, 7–13, 14–29, 30+. Per band: paired change in composite from cut
k to cut k+1 with bootstrap CI, n pairs, n learners. A reference whisker for the < 7-day band is
the "no break" comparison.
Floors: a band is withheld below 20 pairs from 10+ learners; show n for withheld bands.
Caveat: a break is self-selected; learners who return after a month may differ from those who
never left. Cut k+1 may span sessions on both sides of the break; attribute the gap to the first
session after cut k closed.
Endpoint: `GET /v1/analytics/foundational-skills/retention?tenantId=`.
Takeaway copy: "After a break of N+ days, learners come back M points lower/higher (CI …)".

**EFF-12 · Difficulty mix by practice ordinal · `StackedBarChart` (100%) · P1**
Question: do learners move on to harder scenarios as they practise, or stay on easy ones?
Definition: x = learner's Nth countable session (1..12); y = share of sessions at
`scenarios.difficultyLevel` EASY / MEDIUM / HARD / untagged. All-time. Counts in the table view.
Floors: an ordinal withheld below 20 sessions.
Caveat: difficulty is an authoring label, not a measured property; D3 measures it.
Endpoint: `GET /v1/analytics/practice-progression?tenantId=`.

**EFF-13 · Change start → now, within difficulty · dot-and-whisker · P3 (gated)**
Same quantity as AAQ-168 split by majority scenario difficulty of the start and now windows
(easy→easy, easy→hard, hard→hard). Answers whether a flat composite hides learners taking on
harder material. Render only when any cell clears 20 learners; otherwise the gated empty state.
Endpoint: a `dimension=difficultyTransition` value on EFF-03's endpoint.

**EFF-14 · Transfer to a new scenario · paired slope (`BenchmarkSlope`) · P3**
Question: when a learner meets a scenario they have never played, do they bring their skills
with them?
Definition: for each learner with ≥ 3 single-scenario cuts, composite on the first cut of each
*new* scenario vs the composite of the immediately preceding cut on a *repeated* scenario; paired
change, CI. Only single-scenario cuts (§4).
Floors: 20 learners. Caveat: new scenarios are often harder; read with EFF-12.
Endpoint: `GET /v1/analytics/foundational-skills/transfer?tenantId=`.

**EFF-15 · Time to competence · survival curve (`LineChart`, step) · P1**
Question: how many cuts (and minutes) of practice does it take to reach "every basic behaviour
present" on the Engage tier, and what share of learners get there?
Definition: per learner, per Engage skill, the first cut index at which `skillLevels[skill] ≥ 3`
(all basics, no unhelpful). "Engage competence" = level ≥ 3 reached on ≥ 5 of the 6 Engage
skills (parameter `ENGAGE_COMPETENCE_SKILLS = 5`, echoed in the response). Curve: share of
learners who have reached it by cut k, among learners observed to at least cut k (Kaplan–Meier
style, with the at-risk count under each point). Second series for Understand, third for
Support. KPI: median cuts to Engage competence (or "not reached by half" if the curve never
crosses 50%). Also expressed in practice minutes via `user_daily_scores.minutes_played` summed
to the cut's close.
Floors: a point withheld when the at-risk count < 20. Caveat: "reached" is a one-time crossing,
not sustained; `harm` and `confidentiality` are rarely assessable (AAQ-178), which is why the
rule is 5 of 6, and the card says which skill was most often the missing one.
Endpoint: `GET /v1/analytics/foundational-skills/time-to-competence?tenantId=`.

### 6.C Highlights → Curriculum: course effectiveness

**EFF-20 · Helping skills before and after a course · dot-and-whisker per course · P0**
Question: do learners who complete a course help better afterwards than before, and by more
than learners who only practised?
Definition: population = learners with a `track_enrollments.completedAt` under the pinned
rubric. Before = mean composite of the last 2 scored cuts with `closedSessionEndedAt <
enrollment.startedAt`; After = mean of the first 2 scored cuts with `closedSessionEndedAt >
enrollment.completedAt`. Paired change with bootstrap CI and sign test (reuse
`paired-stats.util.ts`), per course and pooled. **Reference series:** the free-practice change
over the same number of intervening cuts, from learners with no enrolment, matched on starting
cut index (median of the matched set, with its CI). Show the reference as a grey whisker beside
each course.
Also report per course: learners completed, learners with both windows (the paired n), median
days enrol→complete, cuts in between.
Floors: a course row withheld below 20 paired learners but listed with n; pooled row withheld
below 20. Caveat on the card: "Before/after on the same learners. Not a trial: people who finish
courses also practise more. The grey whisker is what free practice over the same number of cuts
looked like." Expanded view: per-tier changes (Engage/Understand/Support) for the pooled row.
Endpoint: `GET /v1/analytics/curriculum/course-lift?tenantId=`.

**EFF-21 · Course funnel · horizontal bars per course (`hBarOpts`) + table · P0**
Question: of those enrolled in each course, how many start, reach half, finish, and how long
does it take?
Definition: per ACTIVE track (top 15 by enrolments, rest in the table): enrolled, started
(`startedAt` not null or any item COMPLETED), ≥ 50% items, 100% (`completedAt`), median and IQR
days to complete; stalled = started, no `lastActivityAt` in 30 days. Window: enrolments created
in the selected range (`AnalyticsWindowQueryDto`), default 12m.
Data: `track_enrollments`, `track_item_progress`, `tracks`. Mirrors the tenant-analytics
`course-usage` definitions; share the SQL rather than copy it.
Floors: none for counts; rates shown only with ≥ 5 enrolled.
Endpoint: `GET /v1/analytics/curriculum/course-funnel` (window query + `tenantId`).

**EFF-22 · Where in a course momentum dies · `LineChart` per course (top 5) · P2**
Question: AAQ-050 says which *format* learners stop at; this says *where* in the course.
Definition: x = item position normalised 0–100% of the track's ordered items; y = share of
started enrolments whose progress reached that item (status ≠ LOCKED). One line per course,
`stableScale` colours; expanded view lists the item titles at the steepest drop.
Floors: a course needs ≥ 20 started enrolments. Caveat: sequential unlock means "reached" is
"unlocked", not "opened".
Endpoint: `GET /v1/analytics/curriculum/progress-curve?tenantId=`.

**EFF-23 · Quiz outcomes: first attempt and gain · two cards · P1**
EFF-23a · Pass on first attempt, by quiz · `hBarOpts`: share of learners whose
`attemptNumber = 1` attempt has `passed = true`, per QUIZ item (title from `track_items`),
sorted ascending so the hardest quizzes top the list; n per row.
EFF-23b · First → best attempt gain · dot-and-whisker: per quiz, paired `scorePct` first vs
best among learners with ≥ 2 attempts, with CI; plus share needing 2+ attempts.
Expanded view (both): questions most often wrong on the first attempt, from `grading[]`
(verify its shape: `QuizQuestionGrading` in `ally-be/src/track/type/quiz.type.ts`), by question
id and type, never by answer text.
Floors: a quiz withheld below 20 first attempts. Caveat: open-ended items are LLM-graded (AI task
`track-quiz-grading`); a step in a quiz's pass rate may be a grader change.
Endpoint: `GET /v1/analytics/curriculum/quiz-outcomes?tenantId=` (window on `submittedAt`).

**EFF-24 · Roleplay gates inside courses · `StackedBarChart` per item · P1**
Question: when a course roleplay has a `completion_criteria.minScore`, how often do learners
clear it first time, how many attempts does it take, and how many give up at it?
Definition: per ROLEPLAY track item with a minScore: sessions linked by
`scenario_sessions.trackItemProgressId`; first-attempt pass share
(`meetsMinimumScore(score, minScore)` from `progression.util.ts`), median attempts to pass
(`track_item_progress.attemptCount` at completion), share of progress rows UNLOCKED with ≥ 1
session and no completion after 14 days (stuck). Stack: passed first / passed later / stuck.
Floors: item withheld below 20 progress rows with a session. Caveat: R2 is scenario-scaled; a
gate's pass rate says whether the gate fits the scenario, not whether learners are skilled. A
gate under 40% first-time pass or over 95% is flagged in the takeaway as "check calibration".
Endpoint: `GET /v1/analytics/curriculum/roleplay-gates?tenantId=`.

**EFF-25 · Does knowing predict doing? · `ScatterChart` · P2**
Question: do learners who score well on a course's quizzes also show the skills in roleplay?
Definition: one point per learner-course: x = mean first-attempt `scorePct` over the course's
quizzes; y = mean composite of the learner's scored cuts during and after the course (same
windows as EFF-20). Spearman r with n in the takeaway; no fitted line below 30 points.
Floors: 30 learner-courses. Caveat: both are noisy; a weak r is expected and still useful
(knowledge is not the bottleneck, or the quiz does not test the skill).
Endpoint: `GET /v1/analytics/curriculum/knowledge-vs-skill?tenantId=`.

### 6.D Scenarios as practice content (Curriculum sub-tab, "Scenarios" section)

**EFF-30 · Which skills each scenario actually exercises · heatmap table (`SkillCutGrid` style) · P1**
Question: does the scenario create an opportunity for the skills it is tagged with?
Definition: rows = scenarios with ≥ 20 single-scenario cuts; columns = 14 skills; cell = share of
those cuts where `verdicts[skill].opportunity = true`; cells below 20 cuts show n only. The
scenario's tagged competencies (mapped to FHS keys through the §9 table in the FHS doc;
"Linking Emotions…" maps to nothing) are outlined, so a dim outlined cell is a tag the scenario
does not deliver.
Caveat: opportunity is the judge's call; the self-harm cue, in particular, exists only if the
scenario's persona produces it (FHS doc §10.3).
Endpoint: `GET /v1/analytics/scenarios/opportunity-coverage?tenantId=` (also returns the
single-scenario-cut share).

**EFF-31 · Scenario tags that rarely get an opportunity · table · P1**
Derived from EFF-30: scenarios where a tagged skill's opportunity share is < 30% over ≥ 20 cuts,
with the share and n, sorted by sessions played. This is the content team's fix list. No new
endpoint; a `tagGaps[]` array on EFF-30's response.

**EFF-32 · Scenario difficulty calibration · `StackedBarChart` per scenario · P2**
Question: is EASY actually easy? Where do learners' session scores land per scenario?
Definition: per scenario version with ≥ 20 countable sessions: share of sessions with
`scenario_sessions.score` in bands of the scenario's attainable range. Attainable max = sum of
positive `scenario_events.score` × `detectionConfig.maxOccurrences` (verify the config shape in
`ally-be/src/learn/entity/scenario-events.entity.ts` and `create-scenario-events.dto.ts`); if a
max cannot be derived, fall back to raw bands (< 0, 0–49, 50–99, 100+) and say so. Overlay
the authored `difficultyLevel`. Flag "too easy" (> 80% of sessions in the top band) and "too
hard" (> 50% below 0) in the table. Exclude `score = 0` sessions that also have no events (the
unresolved-score case).
Endpoint: `GET /v1/analytics/scenarios/calibration?tenantId=`.

**EFF-33 · Same-scenario repeat improvement · paired slope · P1**
Question: when a learner replays the same scenario, does their session score rise? This is the
cleanest per-session learner ruler because the scenario is held fixed; it generalises AAQ-189
from one benchmark scenario to all of them.
Definition: per learner and scenario version with ≥ 2 countable sessions ≥ 1 day apart: first
vs latest `score`, normalised by the attainable range when available. One slope per learner on
the selected scenario (picker, top 10 by repeat pairs), plus the pooled paired change with CI
and the share improving. Expanded view: pooled per scenario, table.
Floors: 20 pairs per scenario. Caveat: scores are comparable only within one scenario version;
a version change resets the pairing (`scenarioVersionId`).
Endpoint: `GET /v1/analytics/scenarios/repeat-improvement?scenarioId=&tenantId=`.

**EFF-34 · Did the learner move the client? · `StackedBarChart` over time · P2**
Question: what share of sessions reach the scenario's terminal state, advance at least one
state, or never leave the opening state?
Definition: the "Progression through simulation states" query in
`ally-be/docs/weak-metrics-queries.md`, bucketed by month; stack: reached terminal / advanced
but not terminal / never advanced; sessions without `stateCount` (branching mode, old builds)
reported as a count under the chart, not plotted. Expanded view by scenario.
Caveat: states are score-windowed, so this is a learner-progress proxy only to the extent event
scores track good helping. Endpoint: `GET /v1/analytics/scenarios/progression` (window query).

### 6.E The feedback loop

**EFF-40 · Named improvements that were acted on · change rows · P3 (needs an LLM mapping)**
Question: when the debrief tells a learner to work on X, does X change?
Definition: for each session debrief with `areasOfGrowth[]`, map each `improvement` to an FHS
skill key (a small classification task, new AI task registry row and `LlmTask`, cached per
session). Then, for learners with a scored cut before and after that session: share whose level
on the named skill rose / held / fell, versus skills *not* named in that debrief (the within-
learner control). Floors: 20 learners per skill. Caveat: observational; the named skill is the
one that was weak, so regression to the mean inflates "rose"; the unnamed-skill control is there
for that reason.
Endpoint: `GET /v1/analytics/feedback/uptake?tenantId=`. Build last; the mapping task is the
only new model call in this plan.

### 6.F Dose quality (Usage sub-tab)

**EFF-50 · Was it practice? Learner talk share and turns · two cards · P1**
EFF-50a · Learner talk share per session over time · `LineChart` median with IQR: learner
characters ÷ all characters per countable session (R7), by month; a second line for median
learner turns. Sessions with < 3 learner turns reported as a share ("not practice") in the
takeaway.
EFF-50b · Sessions that count as practice · `SimpleBarChart` by month: share of countable
sessions with ≥ 3 learner turns, ≥ 2 minutes of unpaused duration, and ≥ 300 learner characters
(parameters echoed as `practiceThresholds`). Companion to AAQ-041 (minutes only).
Floors: 20 sessions per bucket. Caveat: characters per word differ by script; compare within a
language (the language dropdown applies).
Endpoint: `GET /v1/analytics/practice-quality` (window query + `language` + `tenantId`).

**EFF-51 · Practice spacing · `SimpleBarChart` histogram · P3**
Days between consecutive countable sessions per learner (all-time), bands 0–1, 2–6, 7–13, 14–29,
30+, as a share of gaps; KPI: share of active learners with a median gap ≤ 7 days.
Endpoint: a `spacing` block on `practice-stickiness`.

### 6.G Perception (Quality & sentiment sub-tab)

**EFF-70 · Satisfaction by practice ordinal · `LineChart` · P3**
`scenario_session_feedbacks.rating` mean and share rated 4–5 by the learner's Nth rated session
(all-time): does satisfaction hold as learners get experienced? Floors: 20 ratings per ordinal.
Endpoint: an `byOrdinal` block on `quality-distribution`.

### 6.H Perception, part two: a self-efficacy instrument (dependency, not a chart yet)

To chart L9 at all, the product needs a short learner self-rating of confidence on the 14 skills
(or the 3 tiers), asked at onboarding and again every N scored cuts or on course completion.
Recommended shape, so the chart can be built the week the data exists:

- Storage: a new `learner_self_assessments` table (`userId`, `tenant_id`, `instrumentVersion`,
  `askedAt`, `trigger` = onboarding | cuts | course, `responses jsonb {skillKey: 1-5}`), or Likert
  quiz items whose `content` carries `skillKey` per statement. The table is cleaner.
- Chart EFF-71 · Confidence start → now, per tier · dot-and-whisker (paired, like AAQ-174).
- Chart EFF-72 · Confidence against competence · `ScatterChart`: x = self-rating, y = FHS level
  in the nearest cut, per skill; quadrant labels "under-confident / calibrated / over-confident".
  Over-confidence on `harm` is the one that matters for safety.
- Ask Stacks about self-efficacy instruments and survey cadence before designing the wording
  (§10).

### 6.I Efficiency

**EFF-60 · Practice per point** is EFF-15's KPI (median cuts, and minutes, to Engage
competence). Lives on the Effectiveness strip and in Helping skills.

**EFF-61 · Cost per improved learner · `KpiTile` · P2**
Learner-caused AI spend in the window (`roleplay-cost` endpoint, the AAQ-076 number) ÷ learners
classified improving beyond noise whose "now" window falls in that period. Both numerator and
denominator shown on the tile; withheld below 20 improving learners. Caveat on the tile: spend
is attributable to all learners, improvement to the measurable subset; this is a ceiling, not a
unit price.

### 6.J Validity

**EFF-80 · Do the rulers agree? · correlation matrix table · P2**
Question: can the cheap per-session signals stand in for the FHS judge?
Definition: over single-scenario cuts, Spearman r (with n) between: R1 composite, R2 session
score normalised within scenario (z-score per scenario version), R3 helpful-minus-unhelpful hit
ratio, R4 mean `skillCoverage`, R6 rating. Cells below 50 pairs show n only. Takeaway names the
strongest and weakest pair.
Caveat: agreement is not validity; two LLM judges can agree and both be wrong. That is what
EFF-81 is for.
Endpoint: `GET /v1/analytics/measurement/convergence?tenantId=`.

**EFF-81 · Judge vs human agreement (dependency + chart)**
AAQ-187 shows "human-rater agreement: not yet measured". To measure it: a table
`fhs_human_ratings` (`cutId`, `raterId`, `rubricVersion`, `ticks jsonb`, `ratedAt`), a sampling
rule (30 cuts per quarter, stratified by composite tercile and language), and a minimal rating
UI (out of scope here; the FHS doc §4 rubric is the instrument). Chart: per skill, Cohen's κ on
level and % agreement on the "any unhelpful" flag, judge vs each human and human vs human.
Specify the table and endpoint in Phase 4; do not build the UI in this plan.

### 6.K Org-level effectiveness (Orgs sub-tab)

**EFF-90 · Org effectiveness scorecard · table with sparklines (like `OrgHealthCard`) · P2**
Per non-test org: measurable learners, composite start→now change ± CI, share improving beyond
noise, unhelpful-behaviour change, course completion rate, self-harm follow-up share (internal).
Rows with < 20 measurable learners show counts and "withheld" for every rate. Sorted by
measurable learners. This is the partner-reporting view and the first candidate to expose, later,
to tenant admins through `tenant-analytics` with the same floors.
Endpoint: `GET /v1/analytics/effectiveness/orgs` (one pass over all tenants; do not call the
progress endpoint per tenant).

---

## 7. Fixes to existing charts (Phase 0)

| Chart | Problem | Fix |
|---|---|---|
| AAQ-042, 043, 044, 045, 046, 047, 049 (Skill growth sub-tab) | Plot actor composite as learner efficacy (§3.1) | **Decision 1 (§11).** Option A, recommended: re-point the sub-tab to R1: x = cut index, y = composite 1–4, keep the all/experienced design, the trend mix and the learner table (with `scoreDomain [1,4]`); update titles, `provenance.derivation`, DTO docs and registry notes; the learner drill-down keeps the knowledge series. Option B: retire the sub-tab's ids and move the four charts, honestly titled "Actor goal score by learner's Nth session", under Quality & sentiment. Either way, no chart titled "learners improving" reads `compositeScore` after Phase 0. |
| AAQ-048 Competency map | Median `compositeScore` per scenario competency tag | Keep the volume axis. Replace the score with the mean FHS level of the mapped skill over single-scenario cuts of scenarios carrying that tag (static map tag→FHS key, `functioning`'s mismatched tag shown as "no FHS equivalent"); if that leaves a tag below the floor, show n and no score, as now. Update the DTO docs and the note in the registry. |
| AAQ-004 Roleplay Quality, AAQ-054 Actor goal score, AAQ-057–060 | Correctly actor-side; titles are fine | Add "AI actor" to `titleHelp` where missing so they cannot be read as learner scores. |
| Learner-facing surfaces (outside admin analytics; flag, do not build here) | Helpline Course progress shows `averageCompositeScore` and per-session `compositeScore`; tenant `learner-usage.avgScore` and `course-usage.avgScore` may read it too | Verify the column each reads. If actor-side, open a separate ticket: learners must see their own score (R2 for the session, FHS for progress), never the actor's. |

---

## 8. Build plan

Four PR groups, backend before frontend inside each. Each PR carries its registry entries,
DTO docs, tests and the `DATA_SCHEMA.md` touch where an entity changes.

| Phase | Scope | Charts | Ships when |
|---|---|---|---|
| **0 · Fix the ruler** | §7 re-pointing; verify learner-facing surfaces; registry notes | AAQ-042–049 updated | Before anything else merges; it changes what every later chart is compared against |
| **1 · Chain + curriculum core** | New Effectiveness sub-tab; course lift; course funnel; retention; time-to-competence; segments; same-scenario repeat; opportunity coverage; practice quality; difficulty mix; quiz outcomes; roleplay gates | EFF-01, 02, 03, 11, 12, 15, 20, 21, 23, 24, 30, 31, 33, 50 | Two backend PRs (effectiveness + curriculum/scenarios), then one frontend PR per sub-tab touched |
| **2 · Depth** | Calibration; progression; progress curve; knowledge vs skill; convergence; org scorecard; cost per improved learner | EFF-22, 25, 32, 34, 61, 80, 90 | After Phase 1 has been read for a week and the floors re-checked against real n |
| **3 · Gated and long-tail** | Dose–response; difficulty transition; transfer; feedback uptake (new AI task); spacing; satisfaction by ordinal | EFF-04, 13, 14, 40, 51, 70 | Each behind its population gate; feedback uptake last |
| **4 · Instruments** | Self-efficacy table + charts; human rating table + κ chart; `competencyIds` on tracks | EFF-71, 72, 81 | After the human decisions in §11 |

Acceptance for every chart:
- registry entry with `note` naming ruler, definition and caveat;
- DTO `@ApiProperty` descriptions that state the definition (house style: the DTO is the spec);
- response echoes `minSampleSize`, `provenance`, `scoping`, `computedAt`;
- repository spec with a fixture that proves floors, test-tenant exclusion, tenant scoping and
  rubric pinning;
- card renders loading, error-with-retry, thin (`n`/`minN`) and empty states via `ChartCard`;
- a transform unit test and a render test following `FoundationalSkillsSubTab.test.tsx`;
- takeaway copy says "associated with", never "caused", for L6 and L7 charts.

---

## 9. Implementation recipes

### 9.1 Backend (ally-be, Node 24)

- Controller: add routes to `src/analytics/controller/analytics.controller.ts` with
  `@RequireFeatureToggle(FeatureToggleKey.ANALYTICS)`; group new ones under
  `effectiveness/`, `curriculum/`, `scenarios/`, `foundational-skills/`, `measurement/`.
- Service + repository pairs in `src/analytics/service` and `src/analytics/repository`, one per
  endpoint family, raw SQL through the query builder as the neighbours do. Register in
  `src/analytics/analytics.module.ts`.
- DTOs in `src/analytics/dto/`, extending `AnalyticsWindowQueryDto` only when the x-axis is a
  calendar; otherwise a `tenantId`-only query DTO with the "all time by construction" header
  comment (copy the pattern from `skill-growth-analytics.dto.ts`).
- Helpers to reuse: `test-tenant.util.ts` (`excludeTestTenants`, `scopeToTenant`, the
  `BySession`/`ByUser` variants), `session-eligibility.util.ts`, `paired-stats.util.ts`,
  `foundational-skills-progress.util.ts` (panel and trend classification, so EFF-02 and EFF-03
  reuse the same classification as AAQ-171/181), `data-floor.util.ts`, `analytics-window.util.ts`.
- Column spelling: physical columns are quoted camelCase (`s."counselorId"`,
  `c."closedSessionEndedAt"`) except `tenant_id` on `BaseEntity` tables. `tenant_id` holds a
  uuid **or** a tenant code; `track_enrollments."tenantId"` is a real uuid. Never compare them
  with `=`; use the helpers.
- Rubric pinning: `WHERE a."rubricVersion" = :rubricVersion` with
  `FHS_RUBRIC_VERSION` from `src/foundational-skills/constants/helping-skills-rubric.constants.ts`,
  and `a.status = 'SCORED'` (check the `FhsAssessmentStatus` enum for the exact value).
- Registry: append entries to `admin-analytics-chart-registry.constants.ts`; its spec
  (`constants/test/admin-analytics-chart-registry.constants.spec.ts`) enforces shape and
  uniqueness.
- New entities (Phase 4 only) → `DATA_SCHEMA.md` §3.16 and §6 in the same PR, plus a migration
  (never edit a merged one).
- New LLM call (EFF-40 only) → `LlmTask` enum value, row in
  `src/llm/constants/ai-task-registry.constants.ts`, and `docs/ai-task-registry.md` recipe.
- Tests: `npm test -- src/analytics` (Jest); `npm run lint:fix`. Run the registry spec and the
  AI-task guard spec whenever those files change.

### 9.2 Frontend (ally-web, **Node 22**)

- Endpoints: add paths to `ApiEndpoints.ANALYTICS` in
  `apps/ally-admin-dashboard/src/constants/common.ts` and hooks to `src/api/analytics.ts`
  (`baseAPI.injectEndpoints`, `windowParams()` for window queries). Types in
  `src/types/analyticsTesting.ts` or beside their transform in `pages/Analytics/*Chart.ts`.
- New sub-tab: add an entry to the `SUB_TABS` list in `pages/Analytics/tabs/HighlightsTab.tsx`
  (`{id:'effectiveness', label:'Effectiveness', blurb, render}`) and a component
  `tabs/EffectivenessSubTab.tsx`. Only the selected sub-tab mounts.
- Cards: `ChartCard` and `KpiTile` from `pages/Analytics/chartKit.tsx`; option factories
  (`lineOpts`, `hBarOpts`, `stackedBarOpts`, `scatterOpts`), `colorScale` from
  `chartScales.ts` (`CATEGORICAL` capped at 8; `stableScale` for course/scenario names;
  `OUTCOME_SCALE` for passed/stuck). Existing custom bodies to reuse: `ChangeWhiskers`
  (dot-and-whisker), `BenchmarkSlope` (paired slopes), `SkillCutGrid` (heatmap table),
  `FunnelBars`, `ChartDetailModal` (expanded view, table, CSV with context).
- Per-card controls persist through `useChartControls`; the Org picker pattern is
  `FoundationalSkillsSubTab.tsx:276-301` (`orgFilterItems`, `useGetTenantsQuery`).
- Every card passes `chartId` (literal AAQ id), `n`, `nUnit`, `minN`, `source` via
  `buildSource({derivation, window, n, asOf})`, and a `takeaway` string computed from the
  response (never from client-side arithmetic that could undo a suppression).
- Tests: stub `requestAnimationFrame` in `vi.hoisted`, mock `@api` wholesale, assert query args
  with the `lastArgs` helper; model files `tabs/__tests__/FoundationalSkillsSubTab.test.tsx`
  and `HighlightsTab.render.test.tsx`. Run `npx vitest run --project ally-admin-dashboard
  src/pages/Analytics`.
- The `dataviz` skill is available in the session, but the repo's `chartKit`/`chartScales`
  are the house system and win on any conflict.

### 9.3 Cross-repo mechanics

- Branches: use the branch names the build session is given; one PR per repo per phase,
  backend PR linked from the frontend PR body. Frontend PRs cannot be verified against prod
  until the backend has deployed; say so in the PR.
- PR template: ally-be's `.github/pull_request_template.md` (Summary, Test plan, Security
  checklist, Documentation). `.docs-map.yml` fires on entity changes (→ `DATA_SCHEMA.md`) and on
  AI-task files (→ registry); analytics repositories other than weak-metrics have no doc rule.
- Nothing in this plan writes to the public wiki; if a build session adds a wiki page, no
  secrets, hostnames or region details.

### 9.4 SQL skeletons for the hardest queries

Course lift (EFF-20), per learner-enrolment, before `paired-stats`:

```sql
WITH scored AS (
  SELECT c."userId", c."cutIndex", c."closedSessionEndedAt" AS closed_at,
         a."compositeScore"::float AS composite
    FROM foundational_skill_cuts c
    JOIN foundational_skill_assessments a ON a."cutId" = c.id
   WHERE a."rubricVersion" = $1 AND a.status = 'SCORED'
     -- excludeTestTenants(); scopeToTenant() on c.tenant_id
),
enrol AS (
  SELECT e.id AS enrollment_id, e."userId", e."trackId", e."startedAt", e."completedAt"
    FROM track_enrollments e
   WHERE e."completedAt" IS NOT NULL
),
before AS (
  SELECT en.enrollment_id, avg(s.composite) AS before_mean, count(*) AS before_n
    FROM enrol en JOIN LATERAL (
      SELECT composite FROM scored s
       WHERE s."userId" = en."userId" AND s.closed_at < en."startedAt"
       ORDER BY s."cutIndex" DESC LIMIT 2) s ON true
   GROUP BY 1),
after AS (
  SELECT en.enrollment_id, avg(s.composite) AS after_mean, count(*) AS after_n,
         min(s."cutIndex") AS first_after_cut
    FROM enrol en JOIN LATERAL (
      SELECT composite, "cutIndex" FROM scored s
       WHERE s."userId" = en."userId" AND s.closed_at > en."completedAt"
       ORDER BY s."cutIndex" ASC LIMIT 2) s ON true
   GROUP BY 1)
SELECT en."trackId", en."userId", b.before_mean, a.after_mean,
       a.after_mean - b.before_mean AS change
  FROM enrol en JOIN before b USING (enrollment_id) JOIN after a USING (enrollment_id)
 WHERE b.before_n = 2 AND a.after_n = 2;
```

The free-practice reference: learners with no row in `track_enrollments`, paired on the same
cut-index distance as the median `first_after_cut − last_before_cut` of the course group,
computed in the same pass.

Retention gaps (EFF-11), consecutive cuts per learner:

```sql
WITH cuts AS (
  SELECT c.id, c."userId", c."cutIndex", c."sessionIds", a."compositeScore"::float AS composite
    FROM foundational_skill_cuts c
    JOIN foundational_skill_assessments a ON a."cutId" = c.id
   WHERE a."rubricVersion" = $1 AND a.status = 'SCORED'),
pairs AS (
  SELECT k."userId", k.composite AS before_c, n.composite AS after_c,
         (SELECT max(s."endedAt") FROM scenario_sessions s WHERE s.id = ANY(k."sessionIds")) AS k_end,
         (SELECT min(s."startedAt") FROM scenario_sessions s
           WHERE s.id = ANY(n."sessionIds") AND NOT (s.id = ANY(k."sessionIds"))) AS n_start
    FROM cuts k JOIN cuts n ON n."userId" = k."userId" AND n."cutIndex" = k."cutIndex" + 1)
SELECT CASE WHEN n_start - k_end < interval '7 days' THEN '<7'
            WHEN n_start - k_end < interval '14 days' THEN '7-13'
            WHEN n_start - k_end < interval '30 days' THEN '14-29' ELSE '30+' END AS band,
       "userId", after_c - before_c AS change
  FROM pairs WHERE n_start IS NOT NULL;
```

Same-scenario repeat (EFF-33):

```sql
SELECT s."counselorId" AS user_id, s."scenarioId", s."scenarioVersionId",
       first_value(s.score) OVER w AS first_score,
       last_value(s.score)  OVER (w RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_score,
       count(*) OVER w2 AS plays
  FROM scenario_sessions s
 WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED' AND s.score IS NOT NULL
   -- countableSessionPredicate(); excludeTestTenants(); scopeToTenant()
WINDOW w  AS (PARTITION BY s."counselorId", s."scenarioId", s."scenarioVersionId" ORDER BY s."startedAt"),
       w2 AS (PARTITION BY s."counselorId", s."scenarioId", s."scenarioVersionId");
```

Keep only `plays >= 2` and a ≥ 1-day span; normalise by attainable range when EFF-32 can derive
it. Opportunity coverage (EFF-30) reads `jsonb_array_elements(a.verdicts)` and groups by
`(scenario, skill)` over single-scenario cuts (`array_length(c."sessionIds",1) = 1`, joined to
`scenario_sessions` on `c."startSessionId"`).

---

## 10. Ask Stacks before building

Stacks was not reachable from the session that wrote this plan. The build session runs these
`search_chunks` queries first (noun phrases, 2–4 per aspect), calls `get_chunks` on the one or
two that bear on the decision, and cites chunk titles in the PR body. Retrieved guidance is
advisory; where it conflicts with §5, state the conflict rather than silently picking one.

- "learning effectiveness measurement framework" and "kirkpatrick evaluation levels"
- "pre post assessment design small samples" and "paired comparison reporting"
- "course completion rate benchmarks" and "learning curve plateau"
- "skill retention decay after training" and "spaced practice interval"
- "self-efficacy survey instrument" and "confidence calibration"
- "dashboard scorecard design executive summary" and "metric tile hierarchy"
- "minimum sample size reporting threshold" and "suppressing small group statistics"
- "feedback uptake measurement" and "coaching loop effectiveness"
- "empty state copy for insufficient data"

The deprecated wiki page on Data Visualisation still holds Ally-specific findings (Carbon
chart overflow, minimum group size for tenant-isolated metrics); check it if a Stacks block
returns nothing for those two.

---

## 11. Decisions for a human

1. **Skill growth sub-tab: re-point (Option A) or retire (Option B)?** §7. Recommendation: A.
   It keeps the ids, the learner drill-down and the knowledge-vs-roleplay timeline, and it makes
   the sub-tab say what people already think it says.
2. **Course → competency mapping.** Add `competencyIds` to `tracks` (recommended, small
   migration, authoring UI change) so course lift can be read per skill; or live with the
   derived "roleplay items' scenario tags" set.
3. **Self-efficacy instrument.** Approve a 3-tier (or 14-skill) 1–5 confidence question set,
   its cadence (onboarding, every 3 scored cuts, course completion), and where it is asked.
   Without it L9 stays unmeasured.
4. **Human rating programme.** Approve a quarterly 30-cut rating sample and name raters, so
   "human-rater agreement: not yet measured" can change. This is the single biggest validity gap.
5. **Learner-facing composite.** If the helpline Course progress page is confirmed to show the
   actor's score as the learner's (§3.1), decide whether to fix it in the same cycle. It is
   outside admin analytics but it is the same bug reaching learners.
6. **Floors for curriculum charts.** The n=20 floor is right for rates; course rows at today's
   volume will mostly be withheld. Confirm that withheld-with-counts is the intended state, or
   approve a lower floor for counts-only course tables.

---

## 12. Appendix: table and column cheat-sheet

| Need | Table · columns |
|---|---|
| Learner's skill levels | `foundational_skill_assessments."skillLevels"` (jsonb `{verbal: 3, …}`), `verdicts[].opportunity`, `compositeScore`, `hasUnhelpfulBehaviour`, `rubricVersion`, `status`; joined to `foundational_skill_cuts` (`userId`, `cutIndex`, `tenant_id`, `sessionIds`, `startSessionId`, `closedSessionEndedAt`, `learnerChars`) |
| Countable session | `scenario_sessions`: `id`, `counselorId` (user), `scenarioId`, `scenarioVersionId`, `status`, `eventStatus`, `startedAt`, `endedAt`, `totalPausedMs`, `score`, `metadata` (`languageId`, `promptVersions`), `tenant_id`, `trackItemProgressId`, `endReason`, `abandonedReason` |
| Session detail | `scenario_session_details`: `callDuration` (ms, net of pauses), `summary` (debrief), `metrics`, `compositeScore` (**actor**), `evaluationStatus` |
| Transcript shape | `scenario_session_messages`: `scenarioSessionId`, `senderId` (−1 = client), `content`, `startSeconds`, `metadata->>'utteranceKind'` |
| Behaviour hits | `scenario_session_behavior_instructions` → `scenario_behavior_instructions` (`scenarioId`, `category`) → `scenario_behavior_instruction_behaviors` → `competency_behaviors` (`competencyId`, `type`) → `competencies.name` |
| Scenario | `scenarios`: `difficultyLevel`, `competencyIds` (jsonb), `category`, `metadata.fhsBenchmark`; `scenario_versions`; `scenario_events.score` and detection config |
| Course | `tracks` (`status`, `isGlobal`, `totalItems`), `track_sections`, `track_items` (`type`, `scenario_id`, `completion_criteria`), `track_enrollments`, `track_item_progress`, `track_quiz_attempts`, `track_annotation_attempts`, `track_journal_entries` |
| Users and orgs | `users` (`id`, `tenant_id`, `lastActiveAt`), `tenants` (`id` uuid, `code`, `isTestOrganization`), `user_groups`/`groups` (roles), `tenant_cohorts`/`tenant_cohort_members` |
| Practice minutes | `user_daily_scores` (`minutes_played`, `total_score`) |
| Ratings | `scenario_session_feedbacks` (`rating`, `tags`) |
| Progression states | `scenario_session_turn_metrics.metadata` (`stateIndex`, `stateCount`, `stateIsTerminal`), from 2026-06-10 |

Reference reading, in order: `ally-be/docs/foundational-helping-skills.md` (§3, §8, §9, §10),
`ally-be/docs/weak-metrics-queries.md` (the four comparability rules),
`ally-be/src/analytics/dto/skill-growth-analytics.dto.ts` and
`foundational-skills-analytics.dto.ts` (the house DTO style), `ally-be/DATA_SCHEMA.md` §3.2,
§3.3, §3.16, `ally-web/apps/ally-admin-dashboard/src/pages/Analytics/chartKit.tsx` header,
`ally-web/.../tabs/FoundationalSkillsSubTab.tsx`, `ally-be/docs/courses-certification-plan.md`
§0 and §3.
