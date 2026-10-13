# Bug Hunter: tools and memory for locating a fault

Added 2026-10-13. Bug Hunter's runs used to see one repo's source and the
running system only through public endpoints. A fix session "fixed"
untranslated simulation titles in the helpline frontend while the cause was
translations ally-be never generated, and a person had to find the missing
rows by hand. These pieces close that gap. Every protocol (fix, finding
Verifier, fix Verifier) renders them in one section, "Your tools for
locating the fault" (`constants/bug-hunter-toolbox.ts`).

## Tools

| Tool | Where | Safety |
|---|---|---|
| Public probes | `productionProbes` in `constants/bug-hunter-probes.constants.ts` | Unauthenticated GETs, what a browser sees |
| Data and log probes | `GET pipeline/probes/:name` → `BugHunterProbeService`; catalogue `PIPELINE_PROBES` | Fixed queries only, `READ ONLY` transaction, 5 s statement timeout, always rolled back; answers are ids, counts and authored text; every call is a `probe` lookup on the run |
| Sibling repos | `/tmp/siblings/<repo>` on every fix and sweep runner (workflow step "Check out the other Ally repos, read-only") | Shallow clone, `.git` removed (no token left on disk), write permission dropped, outside the workspace so it is never committed or linted |
| Log search | the `recent-errors` probe | Backend services only, window capped at 24 h, PII redacted |

Probes today: `scenario-translations`, `tooltip-translations`,
`role-permissions`, `org-preferences`, `languages`, `recent-errors`. Add one
when a class of bug needs it: a fixed query, a `howToRead` line, a test.

The "bot identity" is the pipeline's existing API key, not a user: probes run
server-side with fixed queries, so no account with broad read permissions
exists to leak.

## Memory

| Memory | Where | How it is chosen |
|---|---|---|
| Playbooks | `constants/bug-hunter-playbooks.ts` | Phrase match on title and description; best two |
| Past cases | `BugHunterPrecedentService` | Postgres full-text rank over settled findings; three, with located fault, wrong-fix link or decline reason |
| Feature map | `bug_hunter_feature_maps`, `BugHunterFeatureMapService` | Full-text over card title, summary, entry points and data homes, plus any card naming the bug's file |
| Notebook | unchanged, see `bug-hunter-memory-adr.md` | Embedding search |

Playbooks are reviewed code, not notebook rows: a notebook lesson that keeps
coming back belongs in a playbook. All three reach the fix dossier and the
finding Verifier's brief through `BugHunterKnowledgeService`, which fails
soft.

The feature map is written by a weekly read-only run per repo
(`BugHuntTrigger.FEATURE_MAP`, `bug-hunt-sweep.yml` mode `map`, prompt
`buildFeatureMapPrompt`). An admin can start one from
`POST v1/bug-hunter/feature-maps/refresh` and list cards at
`GET v1/bug-hunter/feature-maps`.

Card rules since the second version (same day): every card names
`valueSource` (database, locale_file, config, code, external) and at least
one data home; a database card names its endpoint, and a client repo's
database card names the backend repo that stores it. One card per feature
across repos: a run posting a slug another repo owns has its entry points,
endpoints and related-repo line merged into that card. An admin removes a
wrong card with `POST v1/bug-hunter/feature-maps/:id/remove {reason}`; the
reason becomes an active notebook lesson tagged `feature-map`/`wrong-card`
that the next map run is told to read. The first run's cards were shallow
(1 to 4 per repo) and one ally-web card described label bundles under a
simulation-titles name, so migration `1976200000000` cleared them.

## Data repairs

A located `data` fault in a repo Bug Hunter can fix no longer stops at a
notification. D5 starts a repair session in the repo that owns the fault
(`repoForFault`), briefed by `renderRepairBrief`: an idempotent backfill with
a dry run by default and tests, never run against production. The PR never
merges itself (`assertMayMerge`); a person reviews it, merges it and runs it.
`config` faults, and data no fixable repo owns, still go to a person.
