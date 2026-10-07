# Skill experiments (auto-improve)

Auto-improve takes one System Skill — a `prompts` row — and keeps trying to make its outputs better,
on real traffic, against a rubric an admin wrote. It is off for every skill until an admin turns it
on, and it can only run on skills whose call site reports what they produced ("connected" skills).

Code: `src/skill-experiment/`. Tables: [DATA_SCHEMA.md §3.18](../DATA_SCHEMA.md). Admin UI:
System Skills → **Experiments** tab (ally-web).

## The loop

```
off ──start──▶ baseline ──enough outputs judged──▶ testing ──target reached / budget spent──▶ paused
                                                    ▲   │                                         │
                                                    └───┘ challenger wins or loses → next draft   │
                                                                                     resume ◀─────┘
```

1. **Baseline.** The skill's text is snapshotted as the run's *Original* and serves 100% of traffic.
   Every output is judged. Once `minSamplesPerVariant` outputs are judged, the run learns the output
   shape (JSON with these keys, or text) and either pauses — the original already meets the target —
   or asks the designer for the first challenger.
2. **Testing.** The champion serves `100 − challengerTrafficPercent`% and one challenger the rest.
   When both have `minSamplesPerVariant` judged outputs the challenger **wins** if it leads by at
   least `minImprovement` points *and* the gap is significant (one-sided Welch z ≥ 1.645); it
   **loses** if it is significantly worse, or has had twice the sample without winning. A winner
   becomes the champion and the loser is retired; either way the designer drafts the next
   challenger from the current champion.
3. **Paused.** The loop stops when the champion's mean reaches `targetScore`, the run has used
   `maxVariants`, `maxConsecutiveLosses` challengers lose in a row, or the designer fails three
   rounds running. **The champion then serves 100% of traffic** until an admin acts.
4. **Admin actions.** *Apply* writes the champion to the skill as a new System Skills version and
   turns the experiment off. *Resume* continues with a fresh variant budget. *Turn off* sends
   every request back to the skill's own text at once.

The engine ticks on the shared 5-minute scheduler bucket, but runs in the background under its own
advisory lock (`SkillExperimentEngineService.kick`) — a tick makes many LLM calls, and the bucket
runs its tasks one after another. `SKILL_EXPERIMENTS_SCHEDULE=off` freezes every loop: experiments
keep serving their current split, but nothing is judged or drafted.

## Guardrails

- **The runtime contract is locked.** Every placeholder token in the original — `{name}`,
  `{{ name }}`, `<name>`, character for character — must survive in a draft, and no new one may
  appear (`util/placeholder-lock.util.ts`). A template with no lone `{` / `}` may not gain one,
  because the Python runtimes fill templates with `str.format`. A draft that fails is retried with
  the errors fed back, then stored as `rejected` and **never served**.
- **The output shape is locked.** If ≥ 80% of the original's outputs were JSON objects, a
  challenger output must be a JSON object with every key they all shared. One that is not — or a
  call that failed outright — scores 0 without a judge call.
- **Bad drafts are pulled early.** A challenger is retired before its full sample if 3+ outputs
  (> 20%) failed or broke the shape, or it trails the champion by 15+ points after a third of the
  sample.
- **A failing challenger never costs a user their result.** Both pilot call sites retry once on the
  skill's own text when the challenger arm throws; the failure is still recorded against the
  challenger.
- **The judge is blind.** It sees the rubric, the input, the output and the *original* instructions
  — never which variant produced the output, and never the variant's text, so a challenger that
  lowered its own bar is still graded against the original job.
- **An admin's edit wins.** If the skill text changes in System Skills while a run is live, the
  next tick restarts the run from the new text.
- **The rubric and judge are fixed for a run.** Changing either is refused while a run is live,
  because scores from a different rubric or judge are not comparable.
- **Nothing on the request path can fail.** `SkillExperimentRouterService.assign` returns null
  (serve the skill as usual) on any error and reads a 30-second snapshot, not the database;
  `record` never rejects. Recording stops while 500+ outputs wait for the judge.

## The judge and the designer

Both are System Skills, editable in the admin like any other: `skill_experiment_judge` and
`skill_experiment_designer` (`src/prompts/skill_experiment/`). Their data arrives as a separate
JSON message, so the files have no placeholders. Both are AI-task-registry rows
(`skill-experiment-judge` with `neverFallback`, `skill-experiment-designer`) and meter to
`llm_usage` with `metadata.experimentId`. The judge scores each criterion 1–5; the overall score is
the weighted mean mapped to 0–100.

## Data

`skill_experiment_observations` stores each judged execution's **raw input and output** — for the
debrief that is the roleplay transcript and the debrief itself — and is kept indefinitely (a product
decision). `tenantId` is stamped on every row. Reading experiments needs
`view:admin:skill-experiments`, which the migration grants only to roles that already hold
`edit:admin:prompts`: observations span every tenant, so multi-tenant admins (who can view prompts)
do not get it.

## Connected skills

| Skill (`promptCode`) | Runtime | Call site |
|---|---|---|
| `track_quiz_open_ended_grading_user` | ally-be | `TrackQuizLlmGraderService.gradeOpenEndedAnswer` |
| `ally_ai_scenario_scenario_evaluation` | ally-ai | `AiService.getScenarioSessionEvaluation` (`needMemory = false`) |
| `ally_ai_scenario_scenario_evaluation_with_memory` | ally-ai | the same, `needMemory = true` |

### Connecting another skill

1. At the call site, ask the router which text to run, and report what happened:

   ```ts
   const arm = await this.skillExperiments.assign(PROMPT_CODE); // null = no experiment
   try {
     const text = arm?.content ?? (await this.promptSharedService.getPromptByCode(PROMPT_CODE));
     const output = await runTheSkill(text, variables);
     void this.skillExperiments.record(arm, { input: variables, output, tenantId });
     return output;
   } catch (error) {
     void this.skillExperiments.record(arm, { input: variables, error: String(error), tenantId });
     if (arm && !arm.isOriginal) return runTheSkill(await ownText(), variables); // never cost the user
     throw error;
   }
   ```

   `input` is what the judge reads as "the data the skill ran on" — pass the variables or the
   request payload, flattened to strings where you can. For an ally-ai skill, send `arm.content`
   in the request's `prompts` map under the **full prompt code** (see `AiService.experimentPromptEntry`).
2. Add the code to `CONNECTED_SKILLS` in `constants/skill-experiment.constants.ts` with a one-line
   output description and a starting rubric.
3. Import `SkillExperimentModule` in the call site's module and add a test for the arm, record and
   fallback paths (see `track-quiz-llm-grader.service.spec.ts`).

Skills in the live voice agent (ally-ai-learn) are not connectable this way yet: their text ships
once per session in the room metadata, and their "output" is a whole conversation.

## Known gap: ally-ai override keys

`AiService.getPromptOverrides` sends ally-ai's dashboard overrides under a slash-mapped key
(`ally_ai_summary_summary` → `summary/summary`), but ally-ai looks prompts up by their full code. So
a System Skills edit to an ally-ai skill does not reach ally-ai today. Connected skills are also sent
under their full code, which is what makes an experiment's variants — and an applied winner —
actually run. Widening that to every ally-ai skill would switch on every dashboard edit that has
silently not applied, all at once. Audit them first:

```sql
SELECT p."promptCode", p."currentVersion", (pv.prompt IS DISTINCT FROM p."defaultPrompt") AS differs
  FROM prompts p
  LEFT JOIN prompts_versions pv ON pv."promptId" = p.id AND pv.version = p."currentVersion"
 WHERE p."promptCode" LIKE 'ally_ai\_%' AND p."promptCode" NOT LIKE 'ally_ai_learn\_%'
   AND p."useDashboardOverride" = true;
```
