# Language Glossary v2 — instance-driven, closed-loop

**Status**: design. Supersedes the consolidation/adjudication halves of the v1 loop; the
compiler, tier knapsack and constraint gates are carried over unchanged.

**Why now**: v1 is open-loop. Annotations become rules, rules get published, and nothing
after that point measures or changes them. Every failure we hit in the first three weeks of
production traces to that one property.

---

## 1. First: the existing design doc is superseded, not stale

`LANGUAGE_GLOSSARY_DESIGN.md` (now `ally-be/docs/`, cited by `glossary.constants.ts`) described a
**human-in-the-loop curation pipeline**. What is in production is an **unattended automated
loop**. That is not drift in the details; it is a different system, and every claim below was
re-derived from code rather than from that doc.

| Old doc says | Code does | Verified in |
|---|---|---|
| §7.2 "**Never auto-publish**" — proposals invisible until a reviewer accepts | An LLM adjudicator publishes autonomously, hourly, `SCHEDULE=apply` | `glossary-adjudication.service.ts` |
| §7.3 Review — admin approves in the Language side panel | No such reviewer exists for ta/kn/hi/mr; that absence is *why* the adjudicator was built | — |
| §7.2.4 `importance` (frequency × severity) drives Tier 0 placement | `importance` is **write-only** — clamped, stored, never read | `language-glossary.service.ts:915` vs `computeTierAssignment` |
| §7.2.4 "Eviction from Tier 0 is a human-approved draft change" | Automated demotion via density knapsack + hysteresis | `tier-assignment.util.ts` |
| §7.2.1 mines `dialect_lexicon`, `colloquialness`, `codeswitch` | Also `register`, `persona_social`, and `fluency` behind a systematicity gate of 5 | `glossary.constants.ts` |
| §7.2.2 the LLM "deduplicates against existing entries" | Three explicit layers; exact + ordered-bigram Jaccard at 0.85 | `glossary-dedupe.util.ts` |
| §10 "v1 = Tamil only" | en, ta, kn, hi, mr all live; English went live 2026-08-20 | prod |
| §7.2 "periodic or admin-triggered" | Weekly scheduler, 168h interval + 24h floor | `glossary-consolidation-scheduler-registration.service.ts` |

Resolved open items (§13) worth closing in place: the Tier 0 cap is 2,000; the tokenizer is
`o200k_base`, as the doc suggested; cadence is a scheduler, not a button.

Absent from the old doc entirely: variety profiles and overlays, the construct-class
pipeline, the lexical contradiction gate, script-consistency filtering, the 90-day recency
bound, adjudication, adherence scanning, and `/analytics/glossary-effect`. Roughly half the
shipped system postdates it.

**Root cause of the drift, and the fix — done 2026-09-03.** `.docs-map.yml` had no rule for
that doc and could not have one: it sat at the *workspace* root, outside `ally-be` and
outside any git repository, so it was unversioned as well as unwatched. It now lives in
`ally-be/docs/` behind a `language-glossary-architecture` rule watching `src/language/**`,
so the next divergence fails CI instead of surfacing a month later.

---

## 2. The reframe

| | v1 (today) | v2 |
|---|---|---|
| Unit of work | an *annotation* (consumed, then gone) | an *instance* (persists, carries status) |
| Publish | terminal | the start of measurement |
| Evidence after a verdict | destroyed (`consumed`) | retained; the verdict marks the *proposal* |
| A rule that doesn't work | immortal and unimprovable | mutated, then evicted |
| Selection | greedy density knapsack | Pareto frontier over instances, then density |
| Validation before publish | none | offline minibatch + held-out non-regression |
| Measurement | aggregate, per language | per rule, per instance |

The pivot is Stage 0. Everything else follows from having a stable, replayable,
scoreable unit.

---

## 3. Stage 0 — the instance set (the new spine)

`language_error_annotations` already contains a complete replayable test case per row.
This was the discovery that makes v2 affordable:

```
userText        -- the counsellor turn (replay INPUT)
aiText          -- the agent's flagged reply (the failing OUTPUT)
evidenceQuote   -- the exact failing span, original script
reasoning       -- the judge's WHY (the reflective-mutation feedback signal)
dimension / category / severity / isolationBasis
conditionedOut  -- garbled-input noise already excluded
llmModel / promptVersion / scenarioVersionId  -- confounders, already denormalized
judgeModel / judgePromptVersion               -- the oracle, already pinned
```

New table `glossary_eval_instances`, derived from those rows:

| column | purpose |
|---|---|
| `id`, `languageId` | identity |
| `category`, `dimension`, `constructClass` | what kind of error this is |
| `inputText`, `failingOutput`, `evidenceQuote`, `judgeReasoning` | the replayable case |
| `occurrences`, `firstSeenAt`, `lastSeenAt` | recurrence weight |
| `annotationIds` | provenance back to the raw rows |
| `llmModel`, `promptVersion`, `judgePromptVersion` | comparability keys |
| `status` | `open` / `resolved` / `contradicted` / `retired` |
| `holdout` | validation split — see below |
| `resolvedByEntryId` | which rule closed it |

Clustering reuses `clusterAnnotations` + `constructClassOf`: one instance per
(construct, category, evidence-similarity) cluster, so 2,409 Tamil annotations
collapse to a few hundred distinct instances rather than becoming 2,409 test cases.

**Held-out split.** `holdout = hash(id) % 10 < 3` — deterministic, ~30%. Held-out
instances are **never** shown to candidate generation and never used for selection;
they exist only to answer "did this rule regress anything". Without the split the loop
optimises rules against the annotations it derived them from, which is how a
self-improving system convinces itself it is working.

**Comparability is structural, not remembered.** An instance is only comparable to
itself within the same `llmModel`. The earlier glossary impact figures dissolved under
segmentation because the grain was added at read time; here it is a column, and the
scorer refuses to compare across models.

---

## 4. Stage 1 — the scorer (no live traffic required)

Produces a **score vector**: one score per instance, per candidate glossary. Two tiers.

**Tier A — deterministic, free.** Does any published rule's avoid-term appear in the
instance's failing output? This is the existing `parseAvoidTerms` + `scanMessages`
adherence scanner, repointed from sessions to instances. Covers lexical rules, which are
most of the glossary. Judge-independent, which matters: it is the one signal that stays
valid if the judge itself is wrong.

**Tier B — offline replay, one completion per instance.** Given `inputText` + the
scenario's context + the compiled glossary under test, generate the next agent turn, then
ask the existing language judge whether `category` recurs — a single-category
judgement, not a full session rubric.

No LiveKit, no TTS, no Google ADC, no learner. This is why v2 runs today with DEMCARES
dark and the v2v A/B still blocked.

**Cost control (GEPA's minibatch/validate split).** Replaying every instance every cycle
is not affordable. So:

- **selection** runs on a minibatch of `N = 40` sampled from open, non-holdout instances,
  weighted by `occurrences × severity`
- **validation** runs the full held-out set, and only for candidates that already passed
  selection

**Honest limit**: Tier B measures the wording the model chooses under the same
system-prompt prefix. It does not measure live conversational dynamics, barge-in, or STT
degradation. It is a proxy — and it is a far better proxy than the aggregate
session metrics v1 relies on, because it is per-rule and it has a control.

---

## 5. Stage 2 — propose **or mutate**

Routing is instance-driven, which is the structural fix:

```
open instance
├── no published rule claims this category  ──►  PROPOSE   (v1 path, kept)
└── a published rule claims it and it still fails  ──►  MUTATE  (new)
```

The mutation reflector receives the rule text, the instance's input/output pair, the
judge's `reasoning`, and the recurrence count — then returns a *targeted edit to that
rule*, not a new rule.

This dissolves the dedupe deadlock by construction. The v1 mechanism is worse than it
looks: `dedupe.addContent(section.content)` indexes every line of *published* content, and a
matching proposal hits `skippedDuplicates++; continue;` — so it is dropped **and its
annotations are never consumed**. The rule is therefore re-derived from the same evidence and
re-dropped on every cycle, forever, which is precisely the infinite loop
`glossary-dedupe.util.ts` documents as the cost of a wrong suppression. For an ineffective
*published* rule it is not a wrong suppression; it is a permanent deadlock. In v2 a near-duplicate of a published line **is** the
mutation trigger. `isDuplicate` returns the matched line instead of a boolean; dedupe
stops being suppression and becomes routing.

Carried over unchanged: the contradiction gate (`scoreLexicalEvidence` — never fight real
learner usage), the systematicity gate for `fluency`, the support floor, the
foreign-script filter, test-tenant exclusion, and rule-form annotation
(`classifyRuleForm` — annotated for the model, never vetoed before it).

---

## 6. Stage 3 — the verification gate

Hermes will not let a task close without empirical proof; Stacks
("Validate Automated Prompt Adjustments Before Deployment") requires offline validation
plus a shadow deployment before rollout. v1 has neither. A candidate publishes only if:

1. it **resolves ≥ 1** open instance on the minibatch, and
2. it **regresses 0** instances on the held-out set, and
3. the resulting Tier 0 set fits `TIER0_TOKEN_CAP`

Dominance on the score vector, not an average — an average lets a rule that fixes three
things and breaks two look like progress.

A candidate failing (1) is dropped; failing (2) goes back to Stage 2 as a mutation with
the regression as feedback; failing (3) goes to Stage 4.

---

## 7. Stage 4 — Pareto tiering and eviction

The knapsack in `computeTierAssignment` stays, including hysteresis and pin precedence.
What changes is the score fed into it, and the selection rule in front of it.

**The current score contains no efficacy signal at all.** Both its components look backward:
`usageOf` counts how often the section's terms appear in live speech (exposure), and
`errorMassOf` sums the severity of the annotations that *created* the rule (how bad the
problem was). Neither asks whether the rule fixed anything. Tier 0 priority is today
proportional to the severity of the disease, not the efficacy of the cure — and a rule born
from ten critical errors keeps its place forever on the strength of those ten errors. The
score vector from §4 is what replaces that input.

**Frontier first.** A rule that is the *sole resolver* of at least one open instance
enters Tier 0 before density is consulted. This is GEPA's Pareto-based selection, and the
instance axis is why it works at our scale — the frontier is over *error patterns*, of
which we have thousands, not over customers, of which we have one per language.

**Then density**, exactly as today, for the remaining budget.

**Eviction (Hermes' admitted gap).** A rule that resolves nothing no other rule resolves is
*dominated*: demote `always` → `retrieved`, and archive after two consecutive cycles with
no sole-resolution. Archived, never deleted — the instance set can re-promote it if the
pattern returns.

This is the answer to the cap starvation that left three good Tamil rules queued at
2,065 / 2,000 tokens. Eviction beats raising the cap, because a cap raise costs tokens on
every turn of every session, permanently.

---

## 8. Stage 5 — canary promotion

Stacks calls for a shadow deployment, and the mechanism already exists: publish to one
variety profile's overlay first (`upsertSection` already takes `profileId`), giving a
within-language control group at zero infrastructure cost. Promote to global on held-out
non-regression across a cycle.

---

## 9. What is reused, new, and retired

**Reused unchanged** — the parts of v1 that were right:
`computeTierAssignment` (knapsack, hysteresis, pins) · `clusterAnnotations` /
`constructClassOf` / `systematicFluency` · `scoreLexicalEvidence` contradiction gate ·
`classifyRuleForm` · the adherence scanner (becomes Tier A) · `excludeForeignScripts` ·
test-tenant exclusion · the 90-day recency bound · `GlossaryConsolidationBatch` as the
rollback handle · the Tier 0 / retrieved compiler · `/analytics/glossary-effect`

**New**: `glossary_eval_instances` + backfill · the two-tier scorer · the mutation path ·
the verification gate · Pareto selection + eviction · canary promotion

**Retired**:
- the consumed-set array scan — `collectConsumedAnnotationIds` rebuilds the entire
  consumed history per run and ships it as `a.id::text <> ALL(:consumedIds)`, a cast that
  defeats the uuid index and an array that grows with every success. Instance `status`
  replaces it with an indexable predicate.
- **the two-vote reject gate** — it exists only because a reject destroys evidence. Once
  the instance set outlives consumption, a reject marks the proposal and the instance
  stays open, so a wrong reject self-corrects on the next cycle. Keep the gate through the
  transition; remove it at Stage 1 completion.
- dedupe-as-suppression, which becomes dedupe-as-routing (§4).

---

## 10. Rollout — strangler, not rewrite

Stacks ("Strangler Pattern for Legacy Architecture Replacement") is explicit: incremental,
reversible, one component at a time. Each step below is independently useful and
independently revertible.

| # | Ships | Behaviour change | Unblocks |
|---|---|---|---|
| 0 | ✅ **Done 2026-09-03.** Both docs tracked in `ally-be/docs/`; `.docs-map.yml` rule watches `src/language/**` | none | stops the next §1 divergence |
| 1 | `glossary_eval_instances` + backfill | none (read-only) | everything |
| 2 | Tier A scorer, per-rule score vectors, reporting only | none | per-rule attribution |
| 3 | Pareto selection + eviction, behind a flag | tiering changes | **the 3 stuck Tamil rules** |
| 4 | Tier B replay + verification gate | publishes get gated | measurement without traffic |
| 5 | Mutation path | ineffective rules change | the dedupe deadlock |
| 6 | Canary promotion | staged publishes | within-language control |

Step 1 ships alone and provably changes nothing. Step 3 is the first user-visible win.

---

## 11. Problems this closes

| Problem found in production | Closed by |
|---|---|
| 3 Tamil rules stuck at 2,065/2,000 tokens | §7 eviction |
| Ineffective rules immortal; dedupe deadlock | §5 mutation |
| Rejects permanent by accident | §3 instance outlives consumption |
| Adjudicator flip-flopped on identical input | §3 verdicts see the trace, not `support=7` |
| Impact figures dissolved under segmentation | §3 comparability columns, §4 per-rule vectors |
| Adherence measures a floor, not naturalness | §4 Tier B scores judge-category recurrence |
| Cannot measure: v2v blocked, DEMCARES dark | §4 offline replay needs no live session |
| Consolidation cost grows with success | §9 instance status replaces the array scan |
| Design doc silently drifted for a month | §1 doc moves in-repo behind a docs-map rule |

## 12. Limits worth stating

- **Tier B is a proxy.** Wording choice under an identical prefix, not live dynamics.
- **The judge is the oracle.** A judge error becomes a rule error. Mitigated by pinning
  `judgePromptVersion` per instance and by Tier A being judge-independent, so eviction
  never depends on the judge being right.
- **Replay has a real bill.** ~40 completions per language per cycle for selection, plus
  the held-out set on candidates that pass. Weekly × 5 languages, this is small; it is not
  free, and the minibatch size is the knob.
- **Out of scope.** The agent drifting into Tamil during English DEMCARES sessions is a
  separate bug and this design does not address it.
