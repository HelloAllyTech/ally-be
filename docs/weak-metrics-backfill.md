# Running the weak-metrics backfills

Three judges populate the Weak Performing Metrics tab with history. They are **HTTP endpoints on
ally-be**, not console commands — there is no shell script to run and nothing to exec into. Call
them with a super-admin token, from Swagger (`https://api.helloally.ai/api-docs`) or curl.

Each returns a job id immediately and runs asynchronously; poll the matching status endpoint.

## Order

1. **ally-ai must be deployed first.** All three call it, and the groundedness judge only exists
   from v1.12.0.
2. **ally-be must have run migrations 1902/1903**, or the v2 label columns and the claim table
   are not there to write into.
3. Then run the three below. They are independent of each other and can overlap, but they share
   the same Gemini quota, so serially is calmer.

## The three calls

`sinceDays: 90` is three months. Start here — see "Extending the window" for why this does not
paint you into a corner.

`concurrency` is how many sessions ONE backfill judges in parallel (default 5, capped at 20).
Above it sits a GLOBAL ceiling of 3 judge calls in flight across every backfill at once, and that
is the limit that actually binds. Three jobs at 5 each once put 15 concurrent calls into the
single core-ai task, pegged it at 100% CPU (2% at rest) and pushed every call past its timeout — a
full run that judged nothing. The global ceiling is a constant, not an API parameter, on purpose:
it describes what the judge can absorb, which is not a caller's decision to make.

Because of it, running all three backfills at once is fine — they share the three slots rather
than opening fifteen.

**Read `failed`, not just `processed`.** `processed` counts attempts, so a run where every call
times out still reaches `processed === total` and reports `done`. `judged` and `failed` are what
say whether anything was written. Expect roughly 6-7 hours for ~1,200 sessions: a 59s median
through 3 slots.

```bash
TOKEN=<super-admin JWT>
API=https://api.helloally.ai/api/v1/analytics
```

**1. Drift re-judge** — the v2 clienthood and progression labels. `judgePromptVersion` is what
makes this a _re_-judge: without it, "already judged" means judged by any rubric, and the run
is a no-op because every session already carries v1 rows.

```bash
curl -X POST "$API/conversation-drift/backfill" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sinceDays": 90, "judgePromptVersion": "v2", "judgeModel": "gemini-2.5-pro", "concurrency": 5}'
```

**2. Language re-judge** — picks up the widened `dialect_lexicon` rubric. Unlike drift there is
no lean path: the judge writes a session row plus a set of annotations and re-judging DELETEs and
re-INSERTs that set, because an error set can SHRINK and an upsert would strand rows the new
rubric no longer finds. So obtaining one widened dimension means re-emitting all of them.

This matters more than the one dimension suggests. The live catch-up judges NEW sessions under v2
continuously, so the dashboard — which pins each family to its most recently written version —
pins language to v2 and shows only the sessions judged since that deploy. 1,776 annotations of
real history sit under v1 and stay invisible until the backlog is re-judged into v2.

```bash
curl -X POST "$API/language-quality/backfill" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sinceDays": 90, "judgePromptVersion": "v2", "judgeModel": "gemini-2.5-pro", "concurrency": 5}'
```

**3. Feedback groundedness** — the new judge; nothing has been judged yet, so this is a first
run rather than a re-judge. The longest of the three: one Gemini call per session.

```bash
curl -X POST "$API/feedback-groundedness/backfill" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sinceDays": 90, "judgePromptVersion": "v1", "judgeModel": "gemini-2.5-pro", "concurrency": 5}'
```

Poll any of them:

```bash
curl "$API/conversation-drift/backfill/<jobId>" -H "Authorization: Bearer $TOKEN"
```

## You should not need to run these by hand

A scheduled task drains the backlog on its own (`JudgeBacklogDrainService`, on the shared
30-minute scheduler), for all three families: drift (lean top-up), groundedness, and language.
Each tick asks one question per family — is a run in flight, and is anything still eligible — and
starts a run only when the answer is no-and-yes. It needs no token,
survives deploys (a killed job is simply restarted next tick), and stops by itself when the
backlog empties, because the selectors exclude everything already judged.

That is the fix for what these calls used to require: a super-admin token that expires every
fifteen minutes, a laptop left awake, and someone remembering to re-issue the call after every
deploy killed the run halfway.

**Each tick takes a bounded chunk** (`BACKLOG_CHUNK`, 25 sessions per family), not the whole
backlog. That is what makes a deploy cheap. An unbounded run took hours, so a restart killed it
mid-flight, the job record still read "running", and the service had to _infer_ the death across
two ticks before starting again — up to an hour of lost progress per deploy, and three deploys in
one morning cost about three hours. A chunk finishes inside its tick, and an interrupted one costs
only the sessions in flight, because the selectors already exclude everything judged. The next tick
simply asks for the next 25. Nothing has to notice the death.

The chunk is sized to the ceiling, not to the backlog: three families share one global limit of
three concurrent judge calls at roughly a minute each, so the platform clears about ninety sessions
per half hour however the work is divided.

**Round-trip WER is topped up separately** (`ROUND_TRIP_CHUNK`), not measured during judging. It is
a TTS call plus an ASR call per sampled utterance against a speech vendor — inline, a timeout held
a judging worker for three minutes on 37% of sessions, spent on a field that renders as "not
measured" either way. The top-up selects only judgments whose `roundTripWerPct` is still NULL, so it
needs no job record and no staleness handling: an interrupted run is just a shorter one.

**Its window is 150 days** (`BACKLOG_WINDOW_DAYS`). It was 30, which turned out to be deciding
what the dashboard could be _asked_: Tamil runs entirely on `gpt-4.1-mini` and every other
language on `gpt-4o-mini`, so "Tamil is worse" and "4.1-mini is worse" were one population and
could not be separated. The sessions that break that tie are the same cohort's April-May runs,
from before the model was pinned, and 30 days put them out of reach.

Widening is a one-off cost, not a standing one — the selectors skip everything already judged, so
the window only decides how much history becomes eligible once.

Two limits worth knowing before reading a backfilled chart:

- **Drift does not reach as far as language.** It runs as a lean top-up over an existing v1 row,
  so it can only extend to sessions that already carry v1 drift labels (roughly July onward).
  Older sessions need a full drift judge — a separate pass, not a wider window.
- **Sessions before 2026-06-10 have no `llmModel`.** Turn metrics start there, and that column is
  the judge's only source for the model. Backfilled rows older than that carry a NULL model and
  cannot be segmented by it, which is the single most explanatory cut we have. Treat unattributed
  rows as their own bucket rather than blending them into a model-segmented view.

It gives up rather than burning money on a broken judge: three consecutive runs that judge
NOTHING while failing trip a breaker, and it logs loudly instead of restarting forever. A run that
judges 300 and fails 4 is normal and clears the count. Fix the cause and restart the service to
reset it.

The calls below remain the way to do something the schedule does not: a different window, a
different rubric version, or a full re-judge.

## Extending the window later

Re-issuing the same call with a larger `sinceDays` **adds the older sessions and re-judges
nothing**. Every selector excludes sessions that already carry rows for that
`(judgeModel, judgePromptVersion)` pair, so the work already paid for is skipped:

```bash
# Later: reach back a year. Only the sessions between 90 days and a year get judged.
-d '{"sinceDays": 365, "judgePromptVersion": "v2", "judgeModel": "gemini-2.5-pro"}'
```

The same property makes an interrupted run resumable — if a backfill dies halfway, re-issue the
identical call and it continues from where it stopped. There is no separate resume mode and no
state to clean up first.

**Always pass `judgePromptVersion`.** It is what scopes "already judged", and it is also what
the dashboard pins to when reading. A run without it judges under whatever the service's current
default is, which is how two rubric versions end up averaged into one line.

## Start narrow

Run 30 days before 90. It finishes in a few hours instead of overnight, puts real data on the tab
the same day, and gives you a measured cost per session before committing to the larger window.
Extending afterwards is free of rework — the selectors skip everything already judged, so the
90-day run only picks up the sessions between 30 and 90 days old.

## What to expect after 90 days

Three months puts roughly six monthly buckets on the drift-derived series and fewer on the
language ones (that judge started in July). Below five buckets the tab renders columns with a
"compared, not trended" caption rather than a line — a line through two points asserts a
direction the data cannot support.

Judge spend for a 90-day window is the low end of the estimate range; the full-history version
was $40–$248 depending on the thinking-token multiplier, and batch mode halves it. Worth running
a ~20-session pilot first with `limit` if you want the real multiplier measured before
committing to a longer window.

## The one thing this cannot backfill

Barge-in and per-turn simulation state are written by the live worker and have no historical
source. Their history starts at the ally-ai-learn deploy. The barge-in series stays "not
measured" until the first interruption is recorded, then flips to charted on its own — no
follow-up deploy, and the pre-deploy zeroes are dropped rather than drawn as a step change.
