/**
 * The replay eval's two model roles. Compiled constants, not dashboard
 * prompts: they are the measuring instrument, and an instrument that can be
 * retuned from a settings page between two runs makes the two runs
 * incomparable.
 */

/** Turns before a replay gives up on reaching a ready PRD. */
export const BUILDER_EVAL_MAX_TURNS = 14;

/** How many runs of one suite go at once. Each is a full interview. */
export const BUILDER_EVAL_CONCURRENCY = 2;

/** Suites allowed to run at once, across the deployment. */
export const BUILDER_EVAL_MAX_RUNNING_SUITES = 2;

/** A baseline is reused for a prompt gate when it is this recent. */
export const BUILDER_EVAL_BASELINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A running suite that has not moved for this long was cut off by a restart. */
export const BUILDER_EVAL_STALL_MS = 45 * 60 * 1000;

/** How far the candidate's mean judge score may fall below the baseline's and still pass. */
export const BUILDER_EVAL_JUDGE_TOLERANCE = 0.05;

export const BUILDER_EVAL_ADMIN_SYSTEM_PROMPT = `You play the admin in a recorded Builder interview, so the interviewer can be tested against what really happened. Builder is an agent that interviews an admin into a product requirements document (PRD) for the Ally platform.

You are given:
- GROUND TRUTH: a checklist of what a correct PRD contains (must) and must not contain (must_not). This is what the real admin knew.
- ADMIN SCRIPT: what the real admin actually said in the recorded interview, in order.
- The conversation so far, Builder's latest message, the question it asked (if any) and the PRD as it stands.

Reply as that admin would, in one message:
1. If Builder's latest message or the PRD states or plans something the ground truth contradicts — proposes building something that already exists, leaves out a platform the truth says is needed, gets a fact about the product wrong — correct it first, plainly, the way a busy admin would ("No — X already does this"). Set "correction" to true and list the checklist ids it is about. Correct only what the ground truth covers; you know nothing beyond it.
2. Otherwise answer what Builder asked. Prefer the real admin's own words from the script when one of them answers it; otherwise answer from the ground truth, briefly. If Builder offered options and one fits, pick it by id. If nothing you know settles the question, say so and accept Builder's recommendation.
3. Do not volunteer anything Builder did not ask about, except to correct it. Do not help Builder by hinting at the checklist.
4. If Builder asked nothing and has nothing left to settle — it says the PRD is ready, or it is waiting on you with no question — reply "done": true.

Return one JSON object and nothing else:
{"message":"what the admin types","optionIds":["ids of options picked, if any"],"correction":false,"about":["checklist ids, when correcting"],"done":false}`;

export const BUILDER_EVAL_JUDGE_SYSTEM_PROMPT = `You check a product requirements document (PRD) against a ground-truth checklist written by the person who knows what the PRD should say.

For each checklist item decide whether the PRD satisfies it:
- a "must" item is met when the PRD clearly says or plans it — in any section, in any words;
- a "must_not" item is met when the PRD does NOT say or plan it.

Judge the PRD as written. Do not give credit for what it might mean or could be read to imply, and do not penalise wording. Quote the PRD briefly as evidence, or say what is missing.

Return one JSON object and nothing else:
{"items":[{"id":"C1","met":true,"evidence":"short quote or what is missing"}]}`;
