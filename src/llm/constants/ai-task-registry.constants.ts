import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmRuntime } from './llm-model-registry.constants';

/**
 * THE AI TASK REGISTRY — the canonical map of every action on this platform
 * that reaches a model over an API, and which model serves it.
 *
 * ## If you are adding an AI call, add it here
 *
 * Every LLM, embedding, transcription, speech or image call in ally-be,
 * ally-ai, ally-ai-learn or the CI coding agents has exactly one row below.
 * A new call without a row is a gap in the map, and the map is what the
 * platform team reads when asking "what does this cost?" and "what breaks if
 * this vendor is down?". `docs/ai-task-registry.md` is the how-to; this file is
 * the data, and the two must not drift — the doc explains the shape and points
 * here rather than repeating the list.
 *
 * Two guards make the rule stick rather than merely stating it:
 *
 *  1. `service/test/ai-task.service.spec.ts` asserts every `LlmTask` member
 *     except UNKNOWN appears on at least one row. Adding a task label without a
 *     row fails CI.
 *  2. `.docs-map.yml` (rule `ai-task-registry`) requires a PR that touches an
 *     LLM client call site to touch this file too.
 *
 * Neither can catch a call that adds no task label and no new client — those
 * rely on review, which is why `detail` is worth filling in properly.
 *
 * ## Why a code constant and not a table
 *
 * Every value here is derived from code: a default in `config.service.ts`, a
 * pydantic Field in `ally-ai/app/core/config.py`, a `--model` flag in a workflow
 * file. A table would be a second copy of those, free to drift, with nothing to
 * catch it. The registry stays in code beside the enum it is keyed on, and
 * `AiTaskService` overlays this deployment's actual env values at read time for
 * the rows ally-be itself runs — so the admin screen shows what IS configured,
 * not only what was written down.
 *
 * ## Models here are DEFAULTS, not facts
 *
 * A model id resolves at request time through four layers, later winning:
 * code default -> `languages.llmConfigId` -> `prompts.model` -> an explicit
 * override on the request or the simulation. See
 * `docs/prompt-llm-config-standardization-adr.md`.
 */

/** Vendor serving a call. `resolved` means it is not known until request time. */
export type AiTaskProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepgram'
  | 'multiple'
  | 'resolved';

/**
 * Shape of the API call. Worth distinguishing because a cost chart that mixes
 * per-token chat spend with per-minute speech spend is unreadable, and because
 * "is this an LLM?" is the first question anyone asks of a row here.
 */
export enum AiTaskKind {
  /** A chat/completion call to a language model. */
  COMPLETION = 'completion',
  /** Text -> vector. Billed per token but has no prompt to reason about. */
  EMBEDDING = 'embedding',
  /** Speech -> text. */
  TRANSCRIPTION = 'transcription',
  /** Text -> speech. */
  SPEECH = 'speech',
  /** Text -> image. */
  IMAGE = 'image',
}

export interface AiTaskEntry {
  /** Stable kebab-case id. Row key in the UI; never reuse one for a new call. */
  id: string;
  /**
   * The label written to `llm_usage.task`, or null when the call records none.
   * A null here is not a licence to skip usage recording on a NEW call — it
   * documents the ones that predate the enum.
   */
  task: LlmTask | null;
  /** Which service executes the call. */
  runtime: LlmRuntime;
  /**
   * What the user or the system did, in the words someone outside the codebase
   * would use. Not the function name.
   */
  trigger: string;
  /** Cadence, constraints, or why this call exists separately from its neighbours. */
  detail?: string;
  /** True when it runs inside a live voice turn, where latency is user-visible. */
  hotPath?: boolean;
  kind: AiTaskKind;
  provider: AiTaskProvider;
  /** The model id this call runs on when nothing overrides it. */
  defaultModel: string;
  /** Where that default lives: env var, constant, or config file field. */
  configuredBy: string;
  /**
   * The prompt row whose own provider/model beats `configuredBy` when it is
   * set, named so a reader can go and look at it.
   *
   * Several ally-be calls read `PromptSharedService.getPromptLlmConfig`, which
   * means `provider` and `defaultModel` on those rows describe the FALLBACK,
   * not a fixed property of the task — an admin who set a Gemini model on the
   * prompt row is running Gemini whatever this file says. Recording the code
   * rather than degrading the row to `provider: 'resolved'` keeps the useful
   * half (what runs when nobody has overridden it) and names the one place to
   * check for the other half.
   */
  promptOverride?: string;
  /**
   * Dot-path into `ConfigService` whose value overrides `defaultModel` in THIS
   * deployment. Only meaningful for ALLY_BE rows — ally-ai and ally-ai-learn
   * read their own env, which this process cannot see. Resolved by
   * `AiTaskService`; a path that no longer exists yields the documented default
   * and is caught by the service's spec.
   */
  configPath?: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ally-ai-learn — the live LiveKit voice worker.
 * Highest volume by far: one learner turn can fire five separate calls, four of
 * them detached from the reply path.
 * ────────────────────────────────────────────────────────────────────────── */

const AI_LEARN_TASKS: AiTaskEntry[] = [
  {
    id: 'agent-turn',
    task: LlmTask.AGENT_TURN,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Learner speaks and the character replies',
    detail:
      "One call per conversational turn. The platform's highest-volume call.",
    hotPath: true,
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'DEFAULT_LLM_CONFIG, then llm_configs / scenario metadata / prompt row',
  },
  {
    id: 'branching-instruction',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Learner trips a branch condition',
    detail:
      'Structured-output call resolving which branching instruction now applies.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'DEFAULT_BRANCHING_LLM_CONFIG (app/core/constants.py)',
  },
  {
    id: 'branching-chat-summary',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A branch condition needs the conversation so far',
    detail:
      'Summarises the transcript into the shape a branching condition can test.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'DEFAULT_BRANCHING_LLM_CONFIG (app/core/constants.py)',
  },
  {
    id: 'rolling-summary',
    task: LlmTask.ROLLING_SUMMARY,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The context window fills mid-session',
    detail:
      'Episodic-memory compaction during the session, plus one final fold at session end.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: "the scenario's main LLM",
    configuredBy: 'Inherits the agent_turn client',
  },
  {
    id: 'client-working-memory',
    task: LlmTask.CLIENT_WORKING_MEMORY,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Every learner turn, off the reply path',
    detail:
      "Derives the character's inner state — stance, affect, ledgers. Same cadence as " +
      'agent_turn but detached, so its spend has to be arguable on its own.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: "the scenario's main LLM",
    configuredBy: 'Inherits the agent_turn client',
  },
  {
    id: 'supervisor-note',
    task: LlmTask.SUPERVISOR_NOTE,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Every committed learner turn',
    detail:
      'Decides whether to push a live coaching hint into the Supervisor tab. It decides ' +
      'no on most turns, so the common case must be near-free.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'SUPERVISOR_NOTES_MODEL / SUPERVISOR_NOTES_PROVIDER',
  },
  {
    id: 'interim-reply',
    task: LlmTask.AGENT_TURN,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Learner pauses and the agent must say something now',
    detail:
      'Fast interim reply covering the gap while the real turn generates.',
    hotPath: true,
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'INTERIM_REPLY_MODEL / INTERIM_REPLY_MODEL_PROVIDER',
  },
  {
    id: 'predictive-filler',
    task: LlmTask.AGENT_TURN,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The agent needs a thinking filler',
    detail:
      "Batch-generated ahead of the turn, and in-turn from the learner's partial " +
      'transcript so the played filler fits what is actually being said.',
    hotPath: true,
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'PREDICTIVE_FILLER_MODEL / PREDICTIVE_FILLER_PROVIDER',
  },
  {
    id: 'knowledge-retrieval',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The agent consults the scenario knowledge base',
    detail:
      'Structured pick of which knowledge keys are relevant to this turn.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: "the scenario's main LLM",
    configuredBy: 'Inherits the agent_turn client',
  },
  {
    id: 'guardrail-detector',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A guardrail is checked against a turn',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'Default on GuardrailEvent (guardrail_event.py)',
  },
  {
    id: 'binary-classifier-detector',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A binary behaviour detector scores a turn',
    detail: '"Did the counsellor do X?", per configured behaviour.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'Default on BinaryClassifierEvent (binary_classifier_event.py)',
  },
  {
    id: 'helper-paraphrased-detector',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The paraphrase detector scores a turn',
    detail: 'Judges whether the learner genuinely paraphrased the caller.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'Default on HelperParaphrasedEvent (helper_paraphrased_event.py)',
  },
  {
    id: 'report-evaluator',
    task: LlmTask.SCENARIO_EVALUATION,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Session ends and the debrief is scored',
    detail:
      'Pinned deliberately at temperature 0. A prompt-level model override is honoured ' +
      'only when it names an OpenAI model — the judge has no other client.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: '_EVALUATOR_MODEL (app/core/scenario_report/evaluator.py)',
  },
  {
    id: 'self-hosted-agent-turn',
    task: LlmTask.AGENT_TURN,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'An operator points a language at a self-hosted model',
    detail:
      'The voice worker is the only runtime that can reach Ollama or vLLM; nothing ' +
      'outside its network can call them.',
    kind: AiTaskKind.COMPLETION,
    provider: 'multiple',
    defaultModel: 'LOCAL_LLM_MODEL',
    configuredBy: 'OLLAMA_BASE_URL / VLLM_BASE_URL',
  },
  {
    id: 'agent-stt',
    task: LlmTask.AGENT_STT,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The live agent listens to the learner',
    hotPath: true,
    kind: AiTaskKind.TRANSCRIPTION,
    provider: 'deepgram',
    defaultModel: 'nova-3',
    configuredBy: 'DEFAULT_STT_CONFIG, then stt_configs / languages',
  },
  {
    id: 'agent-tts',
    task: LlmTask.AGENT_TTS,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The live agent speaks',
    detail:
      'ElevenLabs, Deepgram, Sarvam, Google or Hume, per the voice on the character.',
    hotPath: true,
    kind: AiTaskKind.SPEECH,
    provider: 'multiple',
    defaultModel: 'per-voice',
    configuredBy: 'Voice config on the character',
  },
  {
    id: 'semantic-similarity-embedding',
    task: LlmTask.EMBEDDING,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A semantic-similarity detector scores a turn',
    kind: AiTaskKind.EMBEDDING,
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    configuredBy: 'OPENAI_EMBEDDING_MODEL',
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * ally-ai — post-session analysis, the offline judges, and the WhatsApp bot.
 * Nothing here is on the voice path.
 * ────────────────────────────────────────────────────────────────────────── */

/** Every ally-ai text-generation call falls back to this one pinned model. */
const ALLY_AI_DEFAULT = 'gpt-4o-mini-2024-07-18';
const ALLY_AI_DEFAULT_SOURCE =
  'OpenAIConstants.DEFAULT_MODEL (app/core/constants.py)';

const ALLY_AI_TASKS: AiTaskEntry[] = [
  {
    id: 'session-summary',
    task: LlmTask.SUMMARY,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A counsellor ends a call and a summary is written',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'dynamic-summary',
    task: LlmTask.DYNAMIC_SUMMARY,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A summary is written against a custom note template',
    detail: 'Covers the dictation variant of the same call.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'nudge',
    task: LlmTask.NUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A counsellor is nudged mid-session',
    detail: 'In-session guidance hint on the helpline surface.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'scenario-evaluation',
    task: LlmTask.SCENARIO_EVALUATION,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A roleplay transcript is evaluated',
    detail: 'With or without supervisor memory, depending on the scenario.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'counselor-analysis',
    task: LlmTask.COUNSELOR_ANALYSIS,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Counsellor messages are scored for clinical competency',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'content-enhance',
    task: LlmTask.CONTENT_ENHANCE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'An author clicks Enhance on a note',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'user-identification',
    task: LlmTask.USER_IDENTIFICATION,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A caller is identified from a transcript',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'tag-positivity',
    task: LlmTask.TAG_POSITIVITY,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Tags are scored for positivity',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'diarization',
    task: LlmTask.DIARIZATION,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Uploaded audio is split by speaker',
    detail: 'Chunked across a batch transcription.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'drift-judge',
    task: LlmTask.DRIFT_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: conversation drift is judged',
    detail: 'Did the character wander off its brief?',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'DRIFT_JUDGE__MODEL',
  },
  {
    id: 'language-judge',
    task: LlmTask.LANGUAGE_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: language quality is judged',
    detail:
      'Scores are only comparable within one (MODEL, PROMPT_VERSION) pair, which is why ' +
      'this model is pinned rather than tracking the general default.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'LANGUAGE_JUDGE__MODEL',
  },
  {
    id: 'feedback-groundedness-judge',
    task: null,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: feedback groundedness is judged',
    detail: 'Is the debrief actually supported by the transcript?',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'FEEDBACK_GROUNDEDNESS_JUDGE__MODEL',
  },
  {
    id: 'filler-judge',
    task: LlmTask.FILLER_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: thinking fillers are judged',
    detail: 'Did the filler sound like the character and fit the turn?',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'FILLER_JUDGE__MODEL',
  },
  {
    id: 'analytics-agent-plan',
    task: LlmTask.ANALYTICS_AGENT_PLAN,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'An admin asks the Analytics Agent a question',
    detail:
      'Question to SQL. Carries the whole schema catalogue, so it runs on the stronger model.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'ANALYTICS_AGENT__PLANNER_MODEL',
  },
  {
    id: 'analytics-agent-answer',
    task: LlmTask.ANALYTICS_AGENT_ANSWER,
    runtime: LlmRuntime.ALLY_AI,
    trigger: '...and the rows come back',
    detail:
      'Rows to prose. A different token profile from the planner, hence its own label.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'ANALYTICS_AGENT__ANSWER_MODEL',
  },
  {
    id: 'whatsapp-answer',
    task: null,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A worker sends the WhatsApp bot a question',
    detail:
      'Answers only from retrieved corpus passages, or declines. Claude by default because ' +
      'refusing to answer from outside the passages is an instruction-following problem. ' +
      'Falls back to Gemini when the Anthropic key is missing, and says so in the metadata.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy:
      'KNOWLEDGE_AGENT__DEFAULT_MODEL / KNOWLEDGE_AGENT__DEFAULT_PROVIDER',
    promptOverride: 'ally_ai_knowledge_whatsapp_answer',
  },
  {
    id: 'whatsapp-crisis-classify',
    task: null,
    runtime: LlmRuntime.ALLY_AI,
    trigger: '...and the same message is screened for crisis',
    detail:
      'Runs concurrently with the answer call on every question, so its latency is hidden ' +
      'but its cost is not. Biased towards false positives on purpose.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    configuredBy: 'KNOWLEDGE_AGENT__CRISIS_MODEL',
  },
  {
    id: 'whatsapp-translate-query',
    task: null,
    runtime: LlmRuntime.ALLY_AI,
    trigger: "...and the question isn't in English",
    detail: 'Restates it in English so it embeds against the English corpus.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    configuredBy: 'KNOWLEDGE_AGENT__TRANSLATE_MODEL',
  },
  {
    id: 'corpus-embedding',
    task: LlmTask.EMBEDDING,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Anything is embedded for semantic search',
    detail:
      'Knowledge chunks and roadmap opportunities. 1536 dimensions — Weaviate never ' +
      'vectorises for itself, so this model and that schema are coupled.',
    kind: AiTaskKind.EMBEDDING,
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    configuredBy: 'OpenAIEmbeddingConstants.MODEL',
  },
  {
    id: 'batch-transcription',
    task: LlmTask.TRANSCRIPTION,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Uploaded call audio is transcribed',
    detail:
      'Ordered fallback chain; a provider whose key is missing is skipped at startup, so ' +
      'the default degrades safely.',
    kind: AiTaskKind.TRANSCRIPTION,
    provider: 'multiple',
    defaultModel: 'deepgram → sarvam → openai',
    configuredBy: 'TRANSCRIPTION__PROVIDERS',
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * ally-be — admin, authoring and product surfaces, run in-process.
 * These are the rows whose model this deployment's own env can override, so
 * they carry a `configPath` and `AiTaskService` resolves them live.
 * ────────────────────────────────────────────────────────────────────────── */

const ALLY_BE_TASKS: AiTaskEntry[] = [
  {
    id: 'autofill-field',
    task: LlmTask.AUTOFILL_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author clicks Generate on a simulation field',
    detail:
      'Runs on Anthropic instead when the prompt row selects it — provider, model and ' +
      'temperature all resolve per prompt. A prompt-level Gemini provider is ignored: ' +
      'there is no Gemini autofill executor, so the call falls back rather than breaking.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'OPENAI_AUTOFILL_MODEL / ANTHROPIC_AUTOFILL_MODEL',
    promptOverride: "the field's own prompt row",
    configPath: 'openai.autofillModel',
  },
  {
    id: 'autofill-enhance-field',
    task: LlmTask.AUTOFILL_ENHANCE_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author clicks Enhance on a field',
    detail:
      "Rewrites the field's current value; unlike Generate it never invents content.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'OPENAI_AUTOFILL_MODEL / ANTHROPIC_AUTOFILL_MODEL',
    promptOverride: "the field's own prompt row",
    configPath: 'openai.autofillModel',
  },
  {
    id: 'autofill-agent-field',
    task: LlmTask.AUTOFILL_AGENT_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'The Agent Builder Copilot generates fields',
    detail: 'Fans out one abortable call per field, in parallel.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'OPENAI_AUTOFILL_MODEL / ANTHROPIC_AUTOFILL_MODEL',
    promptOverride: "the field's own prompt row",
    configPath: 'openai.autofillModel',
  },
  {
    id: 'roleplay-copilot',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author chats with the Roleplay Studio copilot',
    detail:
      'Streamed interviewer with a tool loop, capped at 16 round-trips per turn.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ROLEPLAY_COPILOT_MODEL',
    configPath: 'roleplayStudio.copilotModel',
  },
  {
    id: 'character-interview',
    task: LlmTask.CHARACTER_INTERVIEW,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author builds a character in the interview agent',
    detail:
      'Streamed turn, capped at 8 tool round-trips. Anthropic, OpenAI and Gemini all run ' +
      'it — the turn loop goes through AgentLlmProviderFactory, and the provider is ' +
      'inferred from the model id when the prompt row does not name one, so setting a ' +
      'model is normally the whole change. `llm_usage` records whichever provider ran.',
    kind: AiTaskKind.COMPLETION,
    // Not a fixed vendor: the interviewer prompt row wins, then
    // CHARACTER_INTERVIEW_PROVIDER, then inference from the model id.
    provider: 'resolved',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'CHARACTER_INTERVIEW_MODEL / CHARACTER_INTERVIEW_PROVIDER',
    promptOverride: 'character_interview_interviewer_system',
    configPath: 'characterInterview.model',
  },
  {
    id: 'translate-scenario',
    task: LlmTask.TRANSLATE_SCENARIO,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A simulation is translated',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'OPENAI_TRANSLATION_MODEL',
    configPath: 'openai.translationModel',
  },
  {
    id: 'translate-text',
    task: LlmTask.TRANSLATE_TEXT,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A string is translated',
    detail: 'Dynamic i18n, tooltips, behaviour instructions, session events.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'OPENAI_TRANSLATION_MODEL',
    configPath: 'openai.translationModel',
  },
  {
    id: 'translate-object',
    task: LlmTask.TRANSLATE_OBJECT,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A structured object is translated',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'OPENAI_TRANSLATION_MODEL',
    configPath: 'openai.translationModel',
  },
  {
    id: 'translate-agent-template',
    task: LlmTask.TRANSLATE_OBJECT,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An agent prompt template is translated',
    detail:
      'main_agent and branching templates into Indian languages, temperature 0.2. The ' +
      'seeded agent_template_translation prompt row takes precedence over this default.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'PROMPT_TRANSLATION_MODEL / PROMPT_TRANSLATION_PROVIDER',
    promptOverride: 'agent_template_translation',
    configPath: 'promptTranslation.defaultModel',
  },
  {
    id: 'track-quiz-grading',
    task: LlmTask.TRACK_QUIZ_GRADING,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A learner submits an open-ended quiz answer',
    detail: "Graded against the item's rubric.",
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
  {
    id: 'track-memory-fold',
    task: LlmTask.TRACK_MEMORY_FOLD,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A learner finishes a track item',
    detail:
      'Folds per-session memories into one evolving memory per track enrollment.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
  {
    id: 'voice-note-transcribe',
    task: LlmTask.TRANSCRIPTION,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A counsellor dictates a scribe note',
    detail:
      'Accepts webm/mp4/mp3/wav up to 25MB and auto-detects the language.',
    kind: AiTaskKind.TRANSCRIPTION,
    provider: 'openai',
    defaultModel: 'whisper-1',
    configuredBy: 'OPENAI_TRANSCRIPTION_MODEL',
    configPath: 'openai.transcriptionModel',
  },
  {
    id: 'voice-note-extract',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: '...and the dictation is turned into note fields',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
  {
    id: 'coaching-chat',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A learner uses coaching chat',
    detail:
      'Streamed. A Gemini path exists via @google/genai and is selectable per deployment.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'AI_CHAT_OPENAI_MODEL / AI_CHAT_DEFAULT_PROVIDER',
    promptOverride: 'openai_scenario_session_chat',
    configPath: 'aiChat.model',
  },
  {
    id: 'cover-image',
    task: LlmTask.GENERATE_COVER_IMAGE,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author generates a simulation cover image',
    detail: 'Gemini renders from an aspect ratio rather than pixel dimensions.',
    kind: AiTaskKind.IMAGE,
    provider: 'openai',
    defaultModel: 'gpt-image-1',
    configuredBy: 'OPENAI_IMAGE_MODEL / GEMINI_IMAGE_MODEL',
    configPath: 'openai.imageModel',
  },
  {
    id: 'analytics-suggestions',
    task: LlmTask.ANALYTICS_SUGGESTIONS,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin clicks Generate on the Suggestions tab',
    detail:
      'A whole analytics window in, at most ten roadmap suggestions out — the one place a ' +
      'larger model may be worth the latency, so it has its own env var.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_SUGGESTIONS_MODEL',
    configPath: 'anthropic.suggestionsModel',
  },
  {
    id: 'ux-signals',
    task: LlmTask.UX_SIGNALS,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'Scheduled: the UX Signals scan triages PostHog',
    detail:
      'Threshold-crossing detectors become bug findings and roadmap suggestions. Its token ' +
      'profile tracks detector count, not date range.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_SUGGESTIONS_MODEL',
    configPath: 'anthropic.suggestionsModel',
  },
  {
    id: 'mobile-release-whats-new',
    task: LlmTask.MOBILE_RELEASE_WHATS_NEW,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin drafts App Store "What\'s New" copy',
    detail:
      'Turns ally-mobile commit subjects since the last release into release notes.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
  {
    id: 'roadmap-ai',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'Someone runs the guided opportunity interview',
    detail:
      "Interview turns, opportunity drafting, and the Builder drawer's split/merge guard.",
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
  {
    id: 'ai-lab-run',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin runs a skill in AI Lab',
    detail:
      'Model comes from the skill row and the provider is inferred from it. OpenAI and ' +
      'Anthropic only — anything else throws rather than silently substituting.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'lab_skills.model',
    configuredBy: 'lab_skills.model, falling back to ANTHROPIC_AUTOFILL_MODEL',
  },
  {
    id: 'llm-preview',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin tests a prompt in LLM Preview',
    detail:
      'The bench for trying a prompt against a chosen model before saving it.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'chosen in the UI',
    configuredBy: 'Request payload (OpenAI, Anthropic or Gemini)',
  },
  {
    id: 'bug-hunter-repo-classifier',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'Bug Hunter decides which repo a bug belongs to',
    detail: 'The routing step before a sweep or fix session is dispatched.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    configuredBy: 'ANTHROPIC_AUTOFILL_MODEL',
    configPath: 'anthropic.autofillModel',
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Builder — the PRD-interview and coding agent.
 * The only place with explicit model tiering. Defaults live in ONE constant
 * (BUILDER_MODEL_DEFAULTS) because per-getter literals had already drifted once.
 * ────────────────────────────────────────────────────────────────────────── */

const BUILDER_TASKS: AiTaskEntry[] = [
  {
    id: 'builder-interview',
    task: LlmTask.BUILDER_INTERVIEW,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin talks to Builder about what to build',
    detail: 'Streamed PRD interview, tool loop capped at 16 round-trips.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy: 'BUILDER_INTERVIEW_MODEL',
    configPath: 'builder.interviewModel',
  },
  {
    id: 'builder-research',
    task: LlmTask.BUILDER_RESEARCH,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'Builder reads the codebase before answering',
    detail: 'One-shot research pass during the interview.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy: 'BUILDER_INTERVIEW_MODEL',
    configPath: 'builder.interviewModel',
  },
  {
    id: 'builder-interview-summary',
    task: LlmTask.BUILDER_INTERVIEW_SUMMARY,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'The interview grows long',
    detail:
      'Summarises the oldest turns to bound context growth. Sits outside the cached ' +
      'prefix, so a failed summarisation falls back to full replay.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-epic-decomposition',
    task: LlmTask.BUILDER_EPIC_DECOMPOSITION,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A large PRD is cut into milestones',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-opus-5',
    configuredBy: 'BUILDER_PLANNER_MODEL',
    configPath: 'builder.plannerModel',
  },
  {
    id: 'builder-build',
    task: LlmTask.BUILDER_BUILD,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin approves the PRD and the build runs',
    detail:
      'Dispatched to builder-session.yml, which is handed all three tier model ids. ' +
      'Planner and verifier run on claude-opus-5. Usage is reported back by the runner.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy:
      'BUILDER_BUILD_MODEL / BUILDER_PLANNER_MODEL / BUILDER_VERIFIER_MODEL',
    configPath: 'builder.coderModel',
  },
  {
    id: 'builder-lesson-curation',
    task: LlmTask.BUILDER_LESSON_CURATION,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A run finishes and the flywheel folds it in',
    detail: 'Retrospective bullets into the curated lesson set.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-outcome-categorise',
    task: LlmTask.BUILDER_OUTCOME_CATEGORISE,
    runtime: LlmRuntime.ALLY_BE,
    trigger: '...and how the run turned out is categorised',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-context-selection',
    task: LlmTask.BUILDER_CONTEXT_SELECTION,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A new session picks which past lessons to see',
    detail: "Lesson and exemplar selection for the next run's context.",
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Bug Hunter — autonomous find-and-fix, run as headless `claude -p` sessions in
 * GitHub Actions rather than through an SDK. Usage arrives back as the run's
 * --output-format json payload, which the pipeline attaches to the run.
 * ────────────────────────────────────────────────────────────────────────── */

const BUG_HUNTER_TASKS: AiTaskEntry[] = [
  {
    id: 'bug-hunter-sweep',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A scheduled sweep hunts a repo for bugs',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy: '.github/workflows/bug-hunt-sweep.yml (--model)',
  },
  {
    id: 'bug-hunter-verify',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A finding is adversarially verified',
    detail:
      "Invoked twice per unproven finding and given only the finding — never the finder's " +
      "reasoning. Runs on the sweep's own cheap model by design: it must not know more " +
      'than the finder was told.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy: '.claude/agents/bug-verifier.md (inherits the session model)',
  },
  {
    id: 'bug-hunter-fix',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A confirmed bug is fixed',
    detail: 'The fix session opens the PR.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    configuredBy: '.github/workflows/bug-fix-session.yml (--model)',
  },
  {
    id: 'bug-hunter-escalate',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A fix is too hard and escalates',
    detail: 'Buys a stronger model for one hard fix. Pinned per fixable repo.',
    kind: AiTaskKind.COMPLETION,
    provider: 'anthropic',
    defaultModel: 'claude-opus-5',
    configuredBy: '.claude/agents/bug-escalation.md (model:)',
  },
];

/**
 * Every AI call on the platform, in the order a reader should meet them: the
 * live voice path first because it is the highest volume, then the offline
 * analysis, then the surfaces an admin clicks, then the autonomous agents.
 */
export const AI_TASK_REGISTRY: AiTaskEntry[] = [
  ...AI_LEARN_TASKS,
  ...ALLY_AI_TASKS,
  ...ALLY_BE_TASKS,
  ...BUILDER_TASKS,
  ...BUG_HUNTER_TASKS,
];

/**
 * Task labels that legitimately have no registry row.
 *
 * UNKNOWN is the fallback for an un-mapped sender task — it exists so a usage
 * row is never dropped, and no product action produces it. Anything else added
 * here needs a reason in this comment, not just an entry.
 */
export const AI_TASK_REGISTRY_EXEMPT_TASKS: ReadonlySet<LlmTask> = new Set([
  LlmTask.UNKNOWN,
]);
