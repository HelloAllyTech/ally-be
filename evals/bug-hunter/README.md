# Bug Hunter evals

Replayable evaluation of Bug Hunter's prompts against findings whose truth has
since been settled. Roadmap item OPP-0707.

## Why

Until this existed, the only test of a prompt edit was a unit test on the
string, and whether a change to the verifier helped or hurt was learned by
watching production for a week. A replay gives the change a number before it
ships: how often the prompt agrees with what humans and outcomes later
established.

## The set

`GET /api/v1/bug-hunter/pipeline/eval-set?repo=<slug>` (pipeline API key)
returns unproven findings with a truth label:

| Label | Source | Strength | Meaning |
|---|---|---|---|
| `not_a_bug` | `human_declined` | strong | An admin rejected it as not a bug |
| `real` | `reversed` | strong | A dismissal a later shipped fix proved wrong |
| `real` | `merged_held` | strong | The fix merged or released and did not regress |
| `real` | `regressed` | strong | The fix shipped and the bug came back |
| `not_a_bug` | `verifier_dismissed` | weak | Verify refuted it and nothing contradicted that within the suppression window. Off by default (`includeWeak=true`) |

Declines for `wont_fix`, `too_risky`, `duplicate`, `wrong_repo` and `other`
are excluded: they are statements about priority or ownership, not about
whether the code was wrong, which is the only question the verifier answers.
Proven findings (tests, lint, logs) are excluded because the verifier never
runs on them.

Items carry the **original** description where an admin later rewrote it,
since that is the brief the verifier actually judged.

## Running

```bash
# Dry run: fetch the set, pin each item to its commit, print the plan. Spends nothing.
ALLY_BE_API_KEY=... node scripts/bug-hunter/eval-verifier.mjs --repo ally-be --repo-path ../ally-be

# Snapshot the set so later runs compare like with like.
ALLY_BE_API_KEY=... node scripts/bug-hunter/eval-verifier.mjs --repo ally-be --repo-path ../ally-be --snapshot

# Replay a snapshot with the verifier prompt in this checkout, store the score.
ALLY_BE_API_KEY=... node scripts/bug-hunter/eval-verifier.mjs \
  --set evals/bug-hunter/golden-set.ally-be.2026-09-23.json --repo-path ../ally-be \
  --apply --record --notes "what changed in the prompt and why"
```

Each item is replayed in a git worktree of the target repo at the commit that
was current when the finding was filed (`git rev-list -1 --before=<discoveredAt>
origin/master`), so a bug whose fix has since merged still shows as a bug.
Worktrees live under `<repo-path>/.eval-worktrees/` and are reused.

The verifier under test defaults to `.claude/agents/bug-verifier.md` in this
repo. Pass `--verifier <file>` to grade a draft.

## Reading a score

- **Agreement**: share of answered items whose verdict matched the label.
- **Real bugs kept**: share of `real` items the verifier accepted. The cost of
  a miss here is a real bug dismissed.
- **False positives caught**: share of `not_a_bug` items it refuted. The cost
  of a miss here is a reviewer's trust.
- **Per label source**: agreement with the strong tiers is what matters;
  disagreement with the weak tier may mean the old verifier was wrong.
- **Calibration**: agreement bucketed by the verifier's self-reported
  certainty. If the 0.9 bucket is no more often right than the 0.7 bucket, the
  confidence threshold in `BUG_HUNT_LOW_CONFIDENCE_THRESHOLD` is not measuring
  what it claims.

Scores are stored by `POST pipeline/eval-runs` keyed on the sha256 of the
prompt as run plus the model, so two runs of the same pair are the same
experiment. `GET /api/v1/bug-hunter/eval-runs` lists them for the admin tab.

## Layout

- `golden-set.<repo>.<date>.json`: snapshots, committed, so a score can be
  reproduced.
- `results/`: per-run detail including every verdict and reason. Local only,
  gitignored; the summary is what gets recorded.

## Known limits

- One repo per run; the set must not mix repos.
- Items older than the branch history cannot be pinned and are skipped.
- The finder prompt is not replayable yet; only the verifier is.
