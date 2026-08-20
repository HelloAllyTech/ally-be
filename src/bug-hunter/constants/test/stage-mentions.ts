/**
 * Every progress stage a prompt NAMES TO THE AGENT, pulled back out of the
 * prompt text.
 *
 * Both prompts are hand-written prose that tells an external Claude Code
 * session which `stage` strings to POST back, while the accepting end is
 * `BugHuntEventStage` plus a CHECK constraint built from it. Nothing compiled
 * the two together, so they drifted: the sweep prompt advertised
 * `verify_result` where the enum says `verify`, and every Phase-2
 * verification event a sweep reported was rejected by Postgres and lost —
 * for a week, invisibly, because the pipeline treats a failed progress POST
 * as a transient blip and carries on.
 *
 * Extraction is deliberately narrow: only the shapes in which these prompts
 * actually name a stage, so it cannot mistake a *status* (`pending_approval`)
 * or a *source* (`code_review`) for one. A mention written in some new shape
 * goes unchecked rather than failing spuriously — so if you add one, add its
 * shape here too.
 */
export function stageMentions(prompt: string): string[] {
  const found = new Set<string>();
  const add = (s: string) => found.add(s.trim());

  // The `Valid stages: a, b, c.` contract line — the list the agent is
  // handed up front, and where `verify_result` actually lived.
  for (const m of prompt.matchAll(/Valid stages: ([^.]+)\./g)) {
    m[1].split(',').forEach(add);
  }
  // A stage baked into an embedded request body: {"stage":"merged"}.
  for (const m of prompt.matchAll(/"stage":\s*"([a-z_]+)"/g)) add(m[1]);
  // `report stage "escalated"`.
  for (const m of prompt.matchAll(/report stage "([a-z_]+)"/g)) add(m[1]);
  // `report a verify stage`, `report an error stage`.
  for (const m of prompt.matchAll(
    /report (?:a|an|the) ([a-z][a-z_]*) stage/g,
  )) {
    add(m[1]);
  }
  // `report a finder_result for each` — snake_case directly after "report a"
  // is stage-shaped; statuses and sources never appear in that position.
  for (const m of prompt.matchAll(
    /report (?:a|an|the) ([a-z]+(?:_[a-z]+)+)/g,
  )) {
    add(m[1]);
  }

  return [...found];
}
