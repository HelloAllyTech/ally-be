import { LlmTask } from '../../learn/enum/llm-task.enum';

/**
 * What a roleplay SESSION costs to deliver — the taxonomy behind the Priority
 * tab's "Roleplay Cost per Minute" chart.
 *
 * ## The unit is one session, and the test is one question
 *
 * A session is anything that was ever started as a roleplay, however long it
 * ran. Its cost is every AI call that was needed to DELIVER that practice to the
 * learner, from the opening line to the debrief chat: would this call have
 * happened, for this learner, if they had not started this session?
 *
 * That puts in: the character's replies and everything that shapes them
 * (working memory, knowledge retrieval, rolling summary), listening (STT) and
 * speaking (TTS), fillers and holding lines, the per-turn event and rule
 * detectors, live coaching hints, the debrief evaluation, the debrief chat, and
 * the memory folds that carry this session into the learner's next one.
 *
 * It leaves out, on purpose:
 *  - **Authoring** (Studio, copilot, autofill, translation, cover images). Those
 *    calls never carry a session id, so they cannot land here by construction.
 *  - **Analysis for our benefit** — actor evaluation and every judge (drift,
 *    language, filler, recall, RAG, groundedness). They measure the product,
 *    not deliver it, and scale with how much we choose to evaluate. When one
 *    IS tagged to a session it is reported as that session's `excludedCostUsd`,
 *    never folded in and never dropped.
 *
 * ## Why components and not services
 *
 * The chart stacks cost per minute by what the money bought, because that is
 * the question it has to answer: "fillers doubled" is actionable where "LLM
 * went up" is not. Speech-to-text and text-to-speech are still their own
 * components — they are the two biggest non-LLM lines and a vendor switch moves
 * them alone.
 *
 * Only session-tagged rows ever reach this map: attribution is by
 * `llm_usage.scenarioSessionId`. ally-be resolves it from the LiveKit room for
 * ally-ai-learn's rows, and sends it to ally-ai explicitly on the debrief call.
 */
export const SESSION_COST_COMPONENTS = [
  'dialogue',
  'stt',
  'tts',
  'fillers',
  'events',
  'coaching',
  'debrief',
] as const;
export type SessionCostComponent = (typeof SESSION_COST_COMPONENTS)[number];

/** Admin-facing names, in stack order (bottom first). */
export const SESSION_COST_COMPONENT_LABELS: Record<
  SessionCostComponent,
  string
> = {
  dialogue: 'Live dialogue',
  stt: 'Speech-to-text',
  tts: 'Text-to-speech',
  fillers: 'Fillers & holding',
  events: 'Events & rules',
  coaching: 'Live coaching',
  debrief: 'Debrief & memory',
};

/** One line per component, for the chart's legend tooltip and the table. */
export const SESSION_COST_COMPONENT_DESCRIPTIONS: Record<
  SessionCostComponent,
  string
> = {
  dialogue:
    "The character's replies, plus the working memory, knowledge retrieval " +
    'and rolling summary that shape them.',
  stt: "Transcribing the learner's speech during the session.",
  tts: "The character's voice, including the opening line and holding lines.",
  fillers:
    'Thinking fillers, interim replies and back-channels, and the audio clips ' +
    'that voice them.',
  events:
    'Per-turn detectors and rules: behaviours, guardrails, classifiers, ' +
    'paraphrase, semantic similarity and branching.',
  coaching: 'Live supervisor coaching hints sent during the session.',
  debrief:
    'The post-session evaluation and feedback, the debrief chat, and the ' +
    "memory folds that carry this session into the learner's next one.",
};

/**
 * Task → component. A session-tagged task ABSENT from this map is analysis
 * spend: counted as the session's `excludedCostUsd`, never in its cost.
 *
 * Add a task here in the same change that makes it record against a session,
 * or it silently lands in the excluded bucket.
 */
export const SESSION_COST_COMPONENT_BY_TASK: Partial<
  Record<LlmTask, SessionCostComponent>
> = {
  [LlmTask.AGENT_TURN]: 'dialogue',
  [LlmTask.CLIENT_WORKING_MEMORY]: 'dialogue',
  [LlmTask.WORKING_MEMORY_EMBEDDING]: 'dialogue',
  [LlmTask.KNOWLEDGE_RETRIEVAL]: 'dialogue',
  [LlmTask.ROLLING_SUMMARY]: 'dialogue',

  [LlmTask.AGENT_STT]: 'stt',
  [LlmTask.AGENT_TTS]: 'tts',

  [LlmTask.INTERIM_REPLY]: 'fillers',
  [LlmTask.THINKING_FILLER]: 'fillers',
  [LlmTask.BACKCHANNEL_PHRASES]: 'fillers',
  [LlmTask.CLIP_TTS]: 'fillers',

  [LlmTask.BEHAVIOUR_DETECTION]: 'events',
  [LlmTask.GUARDRAIL_CHECK]: 'events',
  [LlmTask.BINARY_CLASSIFIER]: 'events',
  [LlmTask.HELPER_PARAPHRASED]: 'events',
  [LlmTask.EVENT_EMBEDDING]: 'events',
  [LlmTask.BRANCHING_INSTRUCTION]: 'events',
  [LlmTask.BRANCHING_CHAT_SUMMARY]: 'events',

  [LlmTask.SUPERVISOR_NOTE]: 'coaching',

  [LlmTask.SCENARIO_EVALUATION]: 'debrief',
  [LlmTask.DEBRIEF_CHAT]: 'debrief',
  [LlmTask.DEBRIEF_CHAT_SUMMARY]: 'debrief',
  [LlmTask.TRACK_MEMORY_FOLD]: 'debrief',
};

/**
 * Where FULL session-cost logging begins — the chart's cutover marker.
 *
 * Before this change, most of a session's side calls recorded no usage at all
 * and the debrief evaluation recorded usage with no session id. Neither can be
 * recovered for past sessions, so periods before the cutover are UNDERSTATED
 * and must say so.
 *
 * The cutover is measured from the data rather than hard-coded, because the two
 * services that close the gaps deploy independently: it is the LATER of the
 * first session-tagged row carrying any of {@link LIVE_SESSION_COVERAGE_TASKS}
 * (ally-ai-learn shipped) and the first session-tagged `scenario_evaluation`
 * row (ally-ai + ally-be shipped). Until both have appeared, every period is
 * partial — which is the honest answer, not a missing one.
 */
export const LIVE_SESSION_COVERAGE_TASKS: readonly LlmTask[] = [
  LlmTask.INTERIM_REPLY,
  LlmTask.THINKING_FILLER,
  LlmTask.CLIP_TTS,
  LlmTask.KNOWLEDGE_RETRIEVAL,
  LlmTask.WORKING_MEMORY_EMBEDDING,
  LlmTask.BEHAVIOUR_DETECTION,
  LlmTask.GUARDRAIL_CHECK,
  LlmTask.BINARY_CLASSIFIER,
  LlmTask.HELPER_PARAPHRASED,
  LlmTask.EVENT_EMBEDDING,
  LlmTask.BRANCHING_INSTRUCTION,
  LlmTask.BRANCHING_CHAT_SUMMARY,
];

export const DEBRIEF_COVERAGE_TASK = LlmTask.SCENARIO_EVALUATION;
