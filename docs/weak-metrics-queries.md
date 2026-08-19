# Weak performing metrics — querying it by hand

The Weak Performing Metrics tab answers "is this getting better?" for five metrics under one
filter row. It deliberately does **not** answer "why?", and it exposes five slice dimensions
(language, time, model, scenario, prompt version). Everything else — voice, tenant, turn
position, individual claims and quotes — is in the tables and reachable only in SQL.

This page is the bridge: the same definitions the dashboard uses, written so you can run them,
change one line, and get an answer the dashboard cannot give you.

**Read this first, in order:**

1. [Rules that make numbers comparable](#rules-that-make-numbers-comparable)
2. [Where each metric lives](#where-each-metric-lives)
3. [Queries](#queries)
4. [Testing a hypothesis](#testing-a-hypothesis)

Prod access: `docker exec` into the core container and use its own DB env — see the
`SSM → docker exec → node -e` recipe in the wiki. Local: Docker Postgres `ally_local` on 5477.

---

## Rules that make numbers comparable

Break one of these and you will get a number that looks like a finding and isn't. All four have
already produced a false finding in this data.

**1. Pin the judge version — PER JUDGE FAMILY.** Judge output lives at
`(judgeModel, judgePromptVersion)`. A re-judge under a new rubric does not replace the old rows,
it coexists with them, so an unpinned query averages two different definitions of the same word.
v2-only labels (`roleInversion`, `solutionsOffered`, `stuckIsAppropriate`, …) are NULL on v1
rows — count them with `COUNT(*) FILTER (WHERE col)` over a `WHERE col IS NOT NULL` denominator,
never `COALESCE(col, false)`.

**The three judges version independently.** Drift went to v2 when the clienthood labels were
added, language when the `dialect_lexicon` rubric was widened, groundedness is on its first
rubric. "v2" in one table has nothing to do with "v2" in another. Carrying one version across
tables is not a shortcut — the dashboard did exactly that and read the language series through
drift's pin, returning 6 annotations out of 1,782.

```sql
-- Always start here: what versions exist per family, over what period, at what volume.
SELECT 'drift' AS family, "judgeModel", "judgePromptVersion",
       COUNT(*) AS rows, COUNT(DISTINCT "scenarioSessionId") AS sessions,
       MIN("occurredAt")::date AS from_date, MAX("occurredAt")::date AS to_date
  FROM turn_drift_judgment GROUP BY 1, 2, 3
UNION ALL
SELECT 'language', "judgeModel", "judgePromptVersion",
       COUNT(*), COUNT(DISTINCT "scenarioSessionId"),
       MIN("occurredAt")::date, MAX("occurredAt")::date
  FROM language_judgment_sessions GROUP BY 1, 2, 3
UNION ALL
SELECT 'groundedness', "judgeModel", "judgePromptVersion",
       COUNT(*), COUNT(DISTINCT "scenarioSessionId"),
       MIN("occurredAt")::date, MAX("occurredAt")::date
  FROM feedback_claim_judgment GROUP BY 1, 2, 3
 ORDER BY 1, 4 DESC;
```

The dashboard resolves each family's pin as the most recently WRITTEN row (`ORDER BY updatedAt`),
not the highest-sorting version string — versions are opaque labels, not sortable values.

**2. Exclude test tenants**, or internal QA traffic lands in the number. No table below carries
a tenant column, so reach it through the session:

```sql
AND NOT EXISTS (
  SELECT 1 FROM scenario_sessions tts
    JOIN tenants tt ON (tt.id::text = tts."tenant_id" OR tt.code = tts."tenant_id")
   WHERE tts.id = j."scenarioSessionId" AND tt."isTestOrganization" = true)
```

This is `excludeTestTenantsBySession()` in [`src/analytics/util/test-tenant.util.ts`](../src/analytics/util/test-tenant.util.ts).
Keep using the helper in code; it is inlined here only so a paste-and-run query is complete.

**3. Keep numerator and denominator separate; never average pre-divided rates.** Monthly rates
averaged across buckets weight a 40-session month like a 4,000-session one. Every query below
returns `numerator, denominator` and divides once at the end. A zero denominator is *no data* —
it must not render as 0%.

**4. Segment, or you are measuring traffic mix.** Three headline findings in this data turned out
to be composition artefacts, not regressions: branching fire rate, `role_slip` by language, and
hi-IN latency across prompt versions. Repetition alone differs **6.6×** between models, so any
unsegmented movement in it is more likely a shift in which model served traffic than a change in
quality. Before believing a trend, run the [mix check](#did-the-metric-move-or-did-the-traffic).

---

## Where each metric lives

| Metric | Table(s) | Slice columns present |
|---|---|---|
| Actor responsiveness (comprehension) | `language_error_annotations` + `language_judgment_sessions` | language, scenarioId, scenarioVersionId, llmModel, promptVersion, voiceId, judge version |
| Actor responsiveness (barge-in) | `scenario_session_turn_metrics` | language, llmModel, scenarioId, env — **no** promptVersion |
| Progression & resolution | `turn_drift_judgment`, `scenario_session_messages`, `scenario_session_events`, `scenario_session_turn_metrics.metadata` | as above per table |
| Language realism | `language_error_annotations`, plus `scenario_session_messages` for the deterministic off-language check | dimension, category, severity, layer, `evidenceQuote` |
| Feedback groundedness | `feedback_claim_judgment` + `scenario_session_details` | claimKind, verdict, quote accuracy |
| Actor clienthood | `turn_drift_judgment` (v2 labels) | + `userText`/`aiText` for reading the actual turn |

Three things worth knowing about these tables:

- **Judge tables are denormalised on purpose.** `language`, `llmModel`, `promptVersion`,
  `scenarioId`, `scenarioVersionId` and `occurredAt` are copied onto every judgment row, so
  slicing needs no joins. The dashboard filters on five of these; `scenarioVersionId` is
  API-only, and everything below (voice, turn position, verdict, the claim and turn text) is
  SQL-only.
- **`promptVersion` has two routes to the same answer.** The drift and language judges stamp it
  onto every row, derived from `scenario_sessions.metadata->'promptVersions'` — prefer the
  `main_agent`/`base_role` entry, else the first. Tables without the column (feedback claims,
  transcripts, turn metrics) derive it from the session with the same rule. The two agree on
  every judged turn in production, which is what lets one filter selection govern the whole
  tab; if you write a query against a table with no column, mirror
  `mainPromptVersionSql()` rather than inventing a third rule. Older rows carry NULL — those
  sessions predate the metadata, and any prompt-version filter excludes them.
- **`language_judgment_sessions` is the denominator.** A clean session has a row there and no
  annotations. Without joining it, "no errors" and "never judged" are indistinguishable.
- **Some drift rows were topped up rather than judged whole.** A row whose
  `metadata` carries a `labelsBackfill` key had its v1 fields COPIED forward and only the added
  labels judged — the cheap backfill path. The labels are as trustworthy as any other (same
  rubric, same model); the older fields on that row came from the earlier run. Filter on
  `metadata ? 'labelsBackfill'` to tell them apart, e.g. when checking whether a rate differs
  between topped-up history and fully judged live sessions.
- **Judgment rows carry the text.** `turn_drift_judgment.userText`/`aiText` and
  `language_error_annotations.evidenceQuote` mean you can read the actual turns behind a rate
  without going back to the transcript. Do that before forming a hypothesis — a rate tells you
  how often, the text tells you what is happening.

---

## Queries

Every query takes a `$1` window start. Swap `month` for `week` in `date_trunc` for finer
buckets; weekly cells go thin at the window edges.

### Comprehension errors per 100 turns

Severity-weighted (minor 1 / major 5 / critical 10) — the weights live here, not in the judge.
Errors on garbled input are excluded: that is the STT's fault, not the actor's.

```sql
WITH num AS (
  SELECT date_trunc('month', COALESCE(a."occurredAt", a."createdAt")) AS bucket,
         SUM(CASE a."severity" WHEN 'minor' THEN 1 WHEN 'major' THEN 5
                               WHEN 'critical' THEN 10 ELSE 1 END) AS weighted
    FROM language_error_annotations a
   WHERE COALESCE(a."occurredAt", a."createdAt") >= $1
     AND a."judgeModel" = $2 AND a."judgePromptVersion" = $3
     AND a."dimension" = 'understanding'
     AND a."conditionedOut" = false        -- garbled input: the STT's fault
   GROUP BY 1),
den AS (
  SELECT date_trunc('month', COALESCE(s."occurredAt", s."createdAt")) AS bucket,
         SUM(s."turnsJudged") AS turns
    FROM language_judgment_sessions s
   WHERE COALESCE(s."occurredAt", s."createdAt") >= $1
     AND s."judgeModel" = $2 AND s."judgePromptVersion" = $3
   GROUP BY 1)
SELECT to_char(den.bucket, 'YYYY-MM-DD') AS bucket,
       COALESCE(num.weighted, 0) AS numerator,
       den.turns AS denominator,
       ROUND(100.0 * COALESCE(num.weighted, 0) / den.turns, 2) AS per_100_turns
  FROM den LEFT JOIN num ON num.bucket = den.bucket
 WHERE den.turns > 0
 ORDER BY 1;
```

Note `COALESCE("occurredAt", "createdAt")`: `occurredAt` is the session's real time and
`createdAt` is when the judge wrote the row. Backfilled rows carry both; bucketing on
`createdAt` alone would stack a whole backfill into the month it ran.

### Sessions that looped (not turns that repeated)

The turn-level repetition rate averages looping sessions away — a session that repeats six times
in forty turns is 15% and invisible next to healthy traffic. What users complain about is the
*session*, so count sessions containing a run of 3+ consecutive repeats. Gaps-and-islands:

```sql
WITH turns AS (
  SELECT j."scenarioSessionId" AS sid, j."turnIndex" AS idx,
         date_trunc('month', COALESCE(j."occurredAt", j."createdAt")) AS bucket,
         (j."aiReplyFailureMode" = 'repetition') AS rep
    FROM turn_drift_judgment j
   WHERE COALESCE(j."occurredAt", j."createdAt") >= $1
     AND j."judgeModel" = $2 AND j."judgePromptVersion" = $3),
islands AS (
  SELECT sid, rep,
         idx - ROW_NUMBER() OVER (PARTITION BY sid, rep ORDER BY idx) AS grp
    FROM turns),
runs AS (
  SELECT sid, COUNT(*) AS run_len FROM islands WHERE rep GROUP BY sid, grp),
per_session AS (
  SELECT sid, MAX(run_len) AS longest FROM runs GROUP BY sid),
sessions AS (
  SELECT sid, MIN(bucket) AS bucket FROM turns GROUP BY sid)
SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket,
       COUNT(*) FILTER (WHERE COALESCE(p.longest, 0) >= 3)::float AS numerator,
       COUNT(*)::float AS denominator
  FROM sessions s LEFT JOIN per_session p ON p.sid = s.sid
 GROUP BY 1 ORDER BY 1;
```

The judge's own `sessionDrifted` label misses about half of these — it under-detects looping,
which is why the run-length test exists.

### Barge-in

`interrupted` means **this turn was produced by the learner cutting the actor off** — not "this
reply was truncated" (the record ships when the agent starts speaking; LiveKit reports the
interruption when playback ends). Written by the live worker only, so it cannot be backfilled:
every bucket before that deploy is a true zero out of a full denominator, i.e. *not recorded*.

```sql
SELECT to_char(date_trunc('month', tm."occurredAt"), 'YYYY-MM-DD') AS bucket,
       COUNT(*) FILTER (WHERE tm."interrupted")::float AS numerator,
       COUNT(*)::float AS denominator
  FROM scenario_session_turn_metrics tm
 WHERE tm."occurredAt" >= $1 AND tm.source = 'pipeline'   -- backfilled rows have no handler
 GROUP BY 1 ORDER BY 1;
```

Find where the history legitimately starts before quoting any change:
`SELECT MIN("occurredAt") FROM scenario_session_turn_metrics WHERE "interrupted";`

### Progression through simulation states

Nothing in the app reads this yet — it is written for SQL. Each turn carries the state it ran
in, so progression is derivable without a second event stream. States are score-windowed, so
`stateIndex` moving means the cumulative score crossed a window boundary.

```sql
WITH t AS (
  SELECT tm."scenarioSessionId" AS sid, tm."turnIndex" AS idx,
         (tm.metadata->>'stateIndex')::int AS state_idx,
         (tm.metadata->>'stateCount')::int AS state_count,
         (tm.metadata->>'stateIsTerminal')::boolean AS terminal
    FROM scenario_session_turn_metrics tm
   WHERE tm."occurredAt" >= $1 AND tm.metadata ? 'stateCount'),
per_session AS (
  SELECT sid,
         MAX(state_idx) AS furthest,
         MAX(state_count) AS states,
         COUNT(*) AS turns,
         BOOL_OR(terminal) AS reached_end,
         COUNT(DISTINCT state_idx) AS states_visited
    FROM t GROUP BY sid)
SELECT states,
       COUNT(*) AS sessions,
       ROUND(AVG(turns), 1) AS avg_turns,
       COUNT(*) FILTER (WHERE reached_end) AS reached_terminal,
       COUNT(*) FILTER (WHERE states_visited = 1) AS never_advanced
  FROM per_session
 GROUP BY 1 ORDER BY 1;
```

`never_advanced` is the population to read transcripts from: a session that spent every turn in
its opening state either never earned score, or the actor never let it.

`stateId IS NULL` with a `stateCount` present means branching mode, which resolves no scored
state — distinct from an older build that reported no state at all (no `stateCount` key).

### Turns not in the session language at all

Deterministic, judge-independent, and the reason it exists: script fidelity tolerates Latin by
design so code-switching is not punished, which means a 100% English turn scores a perfect 1.0 —
hi-IN reported 99.3% over a corpus containing whole English turns. The `codeswitch` judge
dimension fired once in 429 hi-IN turns.

Only a TOTAL absence of the target script counts. Code-mixing is normal speech
("maybe मैं overthink कर रही हूँ") and a proportional threshold would flag it.

```sql
WITH ranges(lang, lo, hi) AS (VALUES
  ('hi',2304,2431),('mr',2304,2431),('ta',2944,3071),('kn',3200,3327),
  ('ml',3328,3455),('te',3072,3199),('bn',2432,2559),('gu',2688,2815),
  ('pa',2560,2687),('or',2816,2943),('ur',1536,1791)),
ai AS (
  SELECT m.content, lower(split_part(COALESCE(l.value,'en'),'-',1)) AS lang
    FROM scenario_session_messages m
    JOIN scenario_sessions s ON s.id = m."scenarioSessionId"
    LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId','')::int
   WHERE m."senderId" = -1 AND s."createdAt" >= $1
     AND s."roomId" NOT LIKE 'preview-%')
SELECT ai.lang,
       COUNT(*) AS eligible_turns,
       COUNT(*) FILTER (WHERE ai.content !~ ('[' || chr(r.lo) || '-' || chr(r.hi) || ']'))
         AS off_language_turns
  FROM ai JOIN ranges r ON r.lang = ai.lang
 WHERE length(regexp_replace(ai.content,'[^[:alpha:]]','','g')) >= 15
 GROUP BY 1 ORDER BY 2 DESC;
```

Drop the `GROUP BY` and select `content` to read the offending turns. When this fires, check the
SCENARIO before the model: 11 of the first 16 production hits were one opening line stored in
Roman script, repeated across sessions.

### Feedback groundedness

`contradicted` on an `improvement` claim is the harmful case: the learner marked down for work
the transcript shows them doing.

```sql
SELECT to_char(date_trunc('month', c."occurredAt"), 'YYYY-MM-DD') AS bucket,
       c."claimKind", c."verdict",
       COUNT(*) AS claims,
       COUNT(*) FILTER (WHERE c."quotesTranscript"
                          AND NOT COALESCE(c."quoteIsAccurate", true)) AS bad_quotes
  FROM feedback_claim_judgment c
 WHERE c."occurredAt" >= $1
   AND c."judgeModel" = $2 AND c."judgePromptVersion" = $3
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
```

Then read the claims themselves — the rate is the alarm, `claimText` is the diagnosis:

```sql
SELECT c."scenarioSessionId", c."claimText", c."reasoning"
  FROM feedback_claim_judgment c
 WHERE c."claimKind" = 'improvement' AND c."verdict" = 'contradicted'
   AND c."occurredAt" >= $1
 ORDER BY c."occurredAt" DESC LIMIT 25;
```

### Clienthood, by scenario

Role inversion and over-compliance concentrate in particular scenarios rather than spreading
evenly, so the scenario breakdown is the actionable cut — it names the prompt to fix.

```sql
SELECT j."scenarioId", sc.title,
       COUNT(*) AS turns,
       COUNT(*) FILTER (WHERE j."roleInversion") AS inversions,
       COUNT(*) FILTER (WHERE j."solutionsOffered" > 2) AS over_compliant,
       ROUND(100.0 * COUNT(*) FILTER (WHERE j."roleInversion") / COUNT(*), 2) AS inversion_pct
  FROM turn_drift_judgment j
  LEFT JOIN scenarios sc ON sc.id = j."scenarioId"
 WHERE j."occurredAt" >= $1
   AND j."judgeModel" = $2 AND j."judgePromptVersion" = $3
   AND j."roleInversion" IS NOT NULL          -- v2-judged turns only
 GROUP BY 1, 2 HAVING COUNT(*) >= 50
 ORDER BY inversion_pct DESC;
```

---

## Testing a hypothesis

The dashboard shows you *that* something moved. These two queries are what turn a movement into
a decision.

### Two cohorts, side by side

Comparing before/after in time confounds the change with everything else that changed that
month. Compare the thing itself instead — prompt version, model, voice, scenario version — over
the same window.

The dashboard does this one dimension at a time: pick a prompt version, read the number, pick
the other. This query puts both cohorts in one result with their denominators visible, which is
what you want before claiming a difference:

```sql
-- Substitute any denormalised column for "promptVersion".
SELECT j."promptVersion" AS cohort,
       COUNT(DISTINCT j."scenarioSessionId") AS sessions,
       COUNT(*) AS turns,
       COUNT(*) FILTER (WHERE j."inCharacter" = false) AS slips,
       ROUND(100.0 * COUNT(*) FILTER (WHERE j."inCharacter" = false) / COUNT(*), 2) AS slip_pct
  FROM turn_drift_judgment j
 WHERE j."occurredAt" >= $1
   AND j."judgeModel" = $2 AND j."judgePromptVersion" = $3
 GROUP BY 1 HAVING COUNT(*) >= 200
 ORDER BY slip_pct DESC;
```

Two cohorts rarely carry the same traffic. Add `j."llmModel"` (or language) to the `GROUP BY`
and check the difference survives *within* each model before attributing it to the cohort — if
it doesn't, you found a mix difference, not an effect. Watch the denominators: at a few hundred
turns a two-point difference is noise, and this data has no significance test attached.

### Did the metric move, or did the traffic?

Run this whenever a trend line steps. If a segment's *share* moved in the same month the metric
moved, the metric probably didn't:

```sql
SELECT to_char(bucket, 'YYYY-MM-DD') AS month,
       "llmModel",
       turns,
       ROUND(100.0 * turns / SUM(turns) OVER (PARTITION BY bucket), 1) AS share_pct,
       ROUND(100.0 * repeats / turns, 2) AS repetition_pct
  FROM (
    SELECT date_trunc('month', COALESCE(j."occurredAt", j."createdAt")) AS bucket,
           j."llmModel",
           COUNT(*) AS turns,
           COUNT(*) FILTER (WHERE j."aiReplyFailureMode" = 'repetition') AS repeats
      FROM turn_drift_judgment j
     WHERE COALESCE(j."occurredAt", j."createdAt") >= $1
       AND j."judgeModel" = $2 AND j."judgePromptVersion" = $3
     GROUP BY 1, 2
  ) t
 ORDER BY bucket, turns DESC;
```

### Before you act on any of it

- **Is the definition stable across the window?** Deterministic thresholds live in
  `WEAK_METRICS_PARAMS` ([`weak-metrics-analytics.repository.ts`](../src/analytics/repository/weak-metrics-analytics.repository.ts))
  and are versioned by `WEAK_METRICS_VERSION`. Editing one silently moves every historical point,
  so treat it exactly like a judge-prompt change and bump the version.
- **Is the population the same?** A metric can improve because the hard scenarios stopped being
  run. Check session counts per scenario alongside the rate.
- **Did you read the turns?** Every judgment row carries its own text. A rate that nobody has
  read the transcripts behind is a hypothesis, not a finding.

## When this page goes stale

Adding a series to the tab, or changing a threshold in `WEAK_METRICS_PARAMS`, changes the
definitions written here. Update this page in the same PR — a cookbook that disagrees with the
dashboard is worse than no cookbook, because both look authoritative.
