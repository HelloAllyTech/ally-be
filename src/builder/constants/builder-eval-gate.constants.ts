/**
 * Builder prompts whose dashboard edits go live only after the replay eval
 * passes.
 *
 * Their own file, with no imports, because the prompts module reads it: an
 * edit to one of these through the prompt editor is refused, and goes live
 * instead through a `prompt_gate` eval suite that publishes it on a pass.
 * Without this, a dashboard edit to the interviewer changed every interview
 * the moment it autosaved, with no PR and nothing checking it — and since
 * 2026-09-25 the interviewer has run its dashboard version, so the file in
 * the repo is not what production reads.
 *
 * The codes are BUILDER_PROMPTS' values; a spec keeps the two in step.
 */
export const BUILDER_EVAL_GATED_PROMPT_CODES: readonly string[] = [
  'builder_interviewer_system',
  'builder_platform_rules',
];

export const isBuilderEvalGatedPrompt = (promptCode: string): boolean =>
  BUILDER_EVAL_GATED_PROMPT_CODES.includes(String(promptCode ?? ''));

/** Why a gated edit was refused, and where it goes instead. */
export const BUILDER_EVAL_GATE_REFUSAL =
  'This is a Builder prompt: changes to its text or model go live only after ' +
  "Builder's replay eval passes. Submit the change from the prompt editor's " +
  '"Run eval and publish" (or POST /v1/builder/eval/prompt-candidates); it is ' +
  'published automatically if the eval passes.';
