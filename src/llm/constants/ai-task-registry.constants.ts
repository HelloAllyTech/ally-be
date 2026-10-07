import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmModelTier } from './llm-tier.constants';
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
 * ## What is code here, and what is a table
 *
 * The DESCRIPTION of a call stays in code: what triggers it, which runtime
 * executes it, whether it sits on the live voice path, what kind of call it is.
 * Those are properties of the code, so a table holding them would be a second
 * copy free to drift with nothing to catch it. `tier` belongs here for the same
 * reason — "this call can afford reasoning tokens" is a fact about the call
 * site, not an operator's preference.
 *
 * The SELECTION of a model is config, and deliberately not a new table. It
 * used to be a default in `config.service.ts` per service, which meant
 * switching a task was a code change — and because ten services shared one
 * Anthropic-named default, an expired credential took all ten down at once with
 * no lever to move them. It now resolves through
 *
 *   explicit call argument -> prompt row -> platform tier -> compiled-in floor
 *
 * reusing surfaces that already existed: `prompts.provider/model/temperature`
 * (admin-editable in System Skills) and two env vars.
 *
 * So `AiTaskService` no longer reads a config path for tiered rows. It asks
 * `LlmTargetResolverService` what will actually serve the task, which is what
 * keeps this screen honest — those rows previously advertised
 * `anthropic.autofillModel` long after the services stopped reading it.
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
  /**
   * Speech -> lip-synced streaming video. Billed per minute of rendered video
   * rather than per token, and an order of magnitude above the per-minute
   * speech spend beside it, which is the whole reason it is not folded into
   * SPEECH.
   */
  VIDEO = 'video',
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
   * What the call needs when nothing selects a model for it.
   *
   * Set on every row that resolves through `LlmCompletionService`, which reads
   * it FROM HERE rather than taking it as an argument. That is deliberate: a
   * tier passed at the call site could disagree with the tier this screen
   * displays, and a dashboard that misreports which model serves a task is
   * exactly what this registry exists to prevent. One value, two readers.
   *
   * Absent means the call resolves its model some other way — the voice
   * runtime's per-session config, a prompt row that must name a model, or an
   * agentic coding harness whose model is not ours to pick.
   */
  tier?: LlmModelTier;
  /**
   * True for a task whose output is stored and compared over time, where a
   * quiet substitution on another model is worse than a visible failure.
   *
   * Lives here rather than in config because it is a property of the call, not
   * an operator's preference: a judge score is only comparable within one
   * (model, prompt version) pair, and nothing downstream can tell after the
   * fact that a different model produced one row. Absent means fallback is
   * allowed, which is the right default for anything a person reads once.
   */
  neverFallback?: boolean;
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
    trigger:
      'Learner speaks (or types, in a text-chat roleplay) and the character replies',
    detail:
      "One call per conversational turn. The platform's highest-volume call. " +
      'Text-chat roleplays make this same call with no STT/TTS around it.',
    hotPath: true,
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'DEFAULT_LLM_CONFIG, then llm_configs / scenario metadata / prompt row',
  },
  {
    id: 'branching-instruction',
    task: LlmTask.BRANCHING_INSTRUCTION,
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
    task: LlmTask.BRANCHING_CHAT_SUMMARY,
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
      'agent_turn but detached, so its spend has to be arguable on its own. The same ' +
      'call also proposes the delivery plan for the next turn (which catalog opener, ' +
      'pause or short bridge line the reply starts with), so working-memory ' +
      'scenarios need no separate filler/planner call.',
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
    task: LlmTask.INTERIM_REPLY,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'Learner pauses and the agent must say something now',
    detail:
      'Fast interim reply covering the gap while the real turn generates. ' +
      'Superseded, and not called, in sessions where the delivery plan is active ' +
      '(DELIVERY_PLAN_ENABLED with fillers on): its bridge line plays instead.',
    hotPath: true,
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'INTERIM_REPLY_MODEL / INTERIM_REPLY_MODEL_PROVIDER',
  },
  {
    id: 'predictive-filler',
    task: LlmTask.THINKING_FILLER,
    runtime: LlmRuntime.AI_LEARN,
    trigger:
      'The character finishes speaking (plans how the next reply starts)',
    detail:
      'The delivery planner, for scenarios WITHOUT client working memory: one ' +
      'structured call after each character turn, off the reply path, choosing ' +
      "the next turn's opener from a fixed per-language catalog (or a pause, or " +
      'a short bridge line). Working-memory scenarios get the same plan from ' +
      'client-working-memory and make no call here. With DELIVERY_PLAN_ENABLED ' +
      'off, the legacy filler generator records here instead — and that path ' +
      "runs on the scenario's main LLM, not gpt-4o-mini (PREDICTIVE_FILLER_MODEL " +
      'is defined but never read).',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'DELIVERY_PLANNER_MODEL / DELIVERY_PLANNER_MODEL_PROVIDER',
  },
  {
    id: 'backchannel-phrases',
    task: LlmTask.BACKCHANNEL_PHRASES,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The agent prepares listener affirmations for a session',
    detail:
      'Once per session, at session start and off the opening-statement path: ' +
      'one structured-output call for the "mm-hmm"s the character plays while the ' +
      'learner holds the floor. Runs only when the BACKCHANNEL_GLOBALLY_ENABLED ' +
      'kill-switch and the per-simulation continuousBackchanneling toggle are both ' +
      'on, and is skipped when the voice gets no clips (see agent-clip-tts). Text ' +
      'comes from the editable filler/backchannel prompt ' +
      '(ally_ai_learn_filler_backchannel); that row supplies wording only, and its ' +
      'model field is not read.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: "the scenario's main LLM",
    configuredBy: 'Inherits the agent_turn client',
  },
  {
    id: 'knowledge-retrieval',
    task: LlmTask.KNOWLEDGE_RETRIEVAL,
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
    task: LlmTask.GUARDRAIL_CHECK,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A guardrail is checked against a turn',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'Default on GuardrailEvent (guardrail_event.py)',
  },
  {
    id: 'binary-classifier-detector',
    task: LlmTask.BINARY_CLASSIFIER,
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
    task: LlmTask.HELPER_PARAPHRASED,
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
    id: 'behaviour-detection',
    task: LlmTask.BEHAVIOUR_DETECTION,
    runtime: LlmRuntime.AI_LEARN,
    trigger:
      "A learner turn is checked against the simulation's behaviour instructions",
    detail:
      'detect_behaviors in app/core/scenario/simulation_instructions.py: which ' +
      'configured SHOULD / SHOULD NOT behaviours the turn exhibited. One ' +
      'structured-output call per behaviour instruction, on its own OpenAI client ' +
      '(not the agent_turn client), so it does not follow the scenario LLM: a ' +
      'Gemini roleplay still classifies behaviours on gpt-4o-mini.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'SimulationBehaviorInstruction.model default (app/core/scenario/simulation_instructions.py); ally-be sends no model for it',
  },
  {
    id: 'report-counselor',
    task: LlmTask.SCENARIO_REPORT_COUNSELOR,
    runtime: LlmRuntime.AI_LEARN,
    trigger:
      'An author clicks Generate Report in Simulation Studio and the simulated counsellor speaks',
    detail:
      'The counsellor half of a Studio rehearsal (app/core/scenario_report/service.py): one ' +
      'call per turn for the number of turns the author picked, against the client agent ' +
      "running the scenario's own graph. Authoring spend — there is no learner and no " +
      'session, so it never counts towards a learner unit cost. Built with no LLM config, so ' +
      "it runs on the platform default rather than the scenario's model.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'DEFAULT_LLM_CONFIG (app/core/constants.py), via create_llm_client with no config',
  },
  {
    id: 'report-evaluator',
    task: LlmTask.SCENARIO_REPORT_EVALUATION,
    runtime: LlmRuntime.AI_LEARN,
    trigger: '...and the finished rehearsal is scored',
    detail:
      'Not the learner debrief (that is scenario-evaluation, in ally-ai). Its only caller is ' +
      'the Studio rehearsal report: once the simulated counsellor and the client agent have ' +
      'talked for the chosen number of turns, this judge scores the CLIENT agent against the ' +
      'prompt-defined metrics (app/core/scenario_report/evaluator.py). One call per report. ' +
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
    id: 'agent-clip-tts',
    task: LlmTask.CLIP_TTS,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The agent plays a filler, back-channel or interim clip',
    detail:
      'Same provider and voice as agent-tts, synthesized on a separate TTS ' +
      'instance and played on the background track just before the reply. ' +
      'Only fixed-speaker voices get clips (Deepgram, Sarvam bulbul:v2, Google ' +
      'Chirp 3 HD, ElevenLabs flash/turbo/multilingual_v2, Cartesia). Generative ' +
      'voices (ElevenLabs v3, Gemini-TTS, Hume) and anything unclassified get ' +
      'none, and their filler/back-channel/interim LLM calls are skipped too. A ' +
      'worker-wide cache serves repeated phrases with no call; turn openers come ' +
      'from a fixed catalog rendered once per voice, so most are cache hits, plus ' +
      'one bridge-line render per new delivery plan. Recorded as ' +
      'clip_tts per real synthesis (a cache hit costs nothing and records nothing); ' +
      "the session instance's own TTS metrics cover agent-tts only.",
    hotPath: true,
    kind: AiTaskKind.SPEECH,
    provider: 'multiple',
    defaultModel: 'per-voice',
    configuredBy:
      'Voice config on the character; clip policy in BaseTTSClient.allows_clip_synthesis',
  },
  {
    id: 'semantic-similarity-embedding',
    task: LlmTask.EVENT_EMBEDDING,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A semantic-similarity detector scores a turn',
    kind: AiTaskKind.EMBEDDING,
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    configuredBy: 'OPENAI_EMBEDDING_MODEL',
  },
  {
    id: 'working-memory-embedding',
    task: LlmTask.WORKING_MEMORY_EMBEDDING,
    runtime: LlmRuntime.AI_LEARN,
    trigger: "The character's working memory is embedded or recalled",
    detail:
      'Pool vectors for the backstory facts at session start, plus one recall ' +
      'query per turn.',
    kind: AiTaskKind.EMBEDDING,
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    configuredBy: 'OPENAI_EMBEDDING_MODEL',
  },
  {
    id: 'actor-evaluation',
    task: LlmTask.ACTOR_EVALUATION,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'A real session ends and the actor is scored against its goals',
    detail:
      'POST /scenario-session/actor-evaluation, triggered by ally-be at session ' +
      'end and by the catch-up scheduler. It measures the CHARACTER for us, not ' +
      'feedback for the learner, so it is tagged to the session but kept out of ' +
      'the session delivery cost.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      '_EVALUATOR_MODEL (app/core/scenario_report/evaluator.py), shared with report-evaluator',
  },
  {
    id: 'v2v-tester-reply',
    task: LlmTask.V2V_TESTER_REPLY,
    runtime: LlmRuntime.AI_LEARN,
    trigger:
      'A super-admin runs a V2V test (Roleplay Session Logs) and the simulated learner replies',
    detail:
      'The tester bot (app/v2v_tester/tester_bot.py) is the LEARNER side of an AI-vs-AI ' +
      'session: one short reply per exchange, up to the max exchanges picked in the modal ' +
      '(12 by default). The character side is a normal session and records as usual. Test ' +
      'tooling, not learner spend. Its own speech runs on Google STT and TTS, which record ' +
      'no usage.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'Hard-coded in _generate_reply (app/v2v_tester/tester_bot.py)',
  },
  {
    id: 'v2v-role-fidelity-judge',
    task: LlmTask.V2V_ROLE_FIDELITY_JUDGE,
    runtime: LlmRuntime.AI_LEARN,
    trigger: '...and the test run ends',
    detail:
      'One cheap call per run counting tester turns that slipped into the CLIENT role, so a ' +
      "misbehaving tester can be told apart from a weak character in the session's " +
      'evaluation. Best-effort: a failure leaves the count empty.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'Hard-coded in _assess_role_fidelity (app/v2v_tester/tester_bot.py)',
  },
  {
    id: 'video-actor',
    task: null,
    runtime: LlmRuntime.AI_LEARN,
    trigger: 'The character speaks with a face (EXPERIMENTAL, off by default)',
    detail:
      "Renders lip-synced video from the agent's TTS audio for the whole time it " +
      'is speaking, so it bills PER MINUTE OF SPEECH rather than per call — about ' +
      '$0.37/min on Tavus, i.e. roughly $4-5 for one 12-minute roleplay against cents ' +
      'for everything else in that session combined. That makes it the most expensive ' +
      'row in this table by an order of magnitude, which is why it is gated three ways ' +
      "and why it belongs only on roleplays where reading the character's face is part " +
      'of what is being assessed. It costs nothing today: no roleplay sets the flag and ' +
      'no admin holds the video_actor toggle. The default provider (test_pattern) ' +
      'renders in-process and reaches no vendor at all. Any failure falls back to an ' +
      'audio-only session.',
    hotPath: true,
    kind: AiTaskKind.VIDEO,
    provider: 'multiple',
    defaultModel:
      'bey, or tavus/phoenix-3 (test_pattern when unset — no vendor)',
    configuredBy:
      "scenarios.metadata.videoActorProvider per roleplay (Studio: the roleplay's " +
      'Video Actor vendor), falling back to VIDEO_ACTOR_PROVIDER in ally-ai-learn ' +
      'app/core/config.py when a roleplay names none',
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
    id: 'helpline-final-summary',
    task: LlmTask.DYNAMIC_SUMMARY,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'A text-helpline chat that a listener took ends',
    detail:
      'One call per ended chat, off the request path (HelplineSummaryService.' +
      "generateFinal → ally-ai /summary/note). Sends the chat's TEXT turns only " +
      "(talker → CLIENT, listener → COUNSELOR) with the org's summaryFields as " +
      'keys/key_descriptions. Skipped for chats nobody claimed and for erased ' +
      'ones; a failure leaves no row and the listener writes the summary by ' +
      "hand. Never overwrites a listener's edit.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'helpline-rolling-summary',
    task: LlmTask.DYNAMIC_SUMMARY,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      "A text-helpline talker's turn count reaches the org's rolling-summary cadence",
    detail:
      'The same ally-ai /summary/note call as helpline-final-summary, made off the ' +
      'message path every copilot.rollingSummaryEveryTurns talker turns (default 4: ' +
      'turns 4, 8, 12 …) as the ROLLING summary, and once per transfer request as ' +
      "the HANDOFF summary. Input is the chat's TEXT turns so far with the org's " +
      'summaryFields as keys; the request body is redacted from logs. Staff-only ' +
      'output, never shown to the talker. Recorded as DYNAMIC_SUMMARY (no helpline ' +
      'label of its own).',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: ALLY_AI_DEFAULT,
    configuredBy: ALLY_AI_DEFAULT_SOURCE,
  },
  {
    id: 'helpline-risk-screen',
    task: LlmTask.HELPLINE_RISK_CLASSIFY,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      'A talker sends a message in a text-helpline chat (waiting room included)',
    detail:
      'The highest-volume helpline call: one per talker message, after the keyword ' +
      'screen and off the delivery path (HelplineCopilotService → ally-ai ' +
      '/helpline/risk). Input is the message plus the last 4 text turns. 3 s timeout, ' +
      'no retry; a failure records no flag and marks the copilot unavailable while ' +
      'the keyword screen keeps working. Skipped when the org turns ' +
      'copilot.riskClassifier off. Biased towards false positives on purpose; ' +
      "ally-be turns its confidence into HIGH or ELEVATED with the org's " +
      'riskHighConfidence. A prompt row may name another provider/model.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'HELPLINE__RISK_MODEL',
    promptOverride: 'ally_ai_helpline_risk_classify',
  },
  {
    id: 'helpline-copilot-turn',
    task: LlmTask.HELPLINE_COPILOT_TURN,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      'A talker in an active helpline chat pauses for 2.5 seconds after writing',
    detail:
      'One call per talker burst, not per message: debounced 2.5 s after the ' +
      "talker's latest message (a newer message cancels the pending call on every " +
      'replica), ACTIVE chats only — plus one when a listener claims a chat the ' +
      'talker has already written in. Input is the last 12 text turns, the rolling ' +
      "summary and the chat's risk level. Returns 2–3 suggested replies for the " +
      'listener (never sent to the talker), the conversation stage and — at most 10 ' +
      'times per chat, never on the first talker turn or two talker turns running — a ' +
      'coaching nudge. 6 s timeout, no retry. Skipped when the org turns off both ' +
      'suggestions and nudges. A prompt row may name another provider/model.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4.1-mini',
    configuredBy: 'HELPLINE__TURN_MODEL',
    promptOverride: 'ally_ai_helpline_copilot_turn',
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
    id: 'scenario-evaluation-language',
    task: LlmTask.SCENARIO_EVALUATION_LANGUAGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      'Someone opens a debrief in a UI language other than the one it was written in',
    detail:
      'ally-be (ScenarioSessionService.generateLanguageSummary) asks ally-ai to re-run the ' +
      "same evaluation in the viewer's language, without memory, and caches the result per " +
      'language on the session, so it runs at most once per (session, language) unless the ' +
      'previous attempt failed. Same endpoint and model as scenario-evaluation; ally-be ' +
      'sends usage_task so it records under its own label and the cost of multilingual ' +
      'debriefs is visible. Counted as feedback spend on the session.',
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
    id: 'drift-judge-labels',
    task: LlmTask.DRIFT_JUDGE_LABELS,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      'Scheduled: the judge backlog drainer tops up drift labels on already-judged sessions',
    detail:
      'POST /drift/judge-labels, the lean path: same rubric, model and temperature as ' +
      'drift-judge, but the response is constrained to the labels added since v1, which ' +
      'is where most of the cost is (completion outweighs the re-sent transcript). Only ' +
      'reaches sessions that already carry a v1 judgment; also runnable by hand as a ' +
      'drift backfill with lean set. Its own label so the saving over drift-judge is ' +
      'measured rather than asserted.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'DRIFT_JUDGE__MODEL, shared with drift-judge',
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
    task: LlmTask.FEEDBACK_GROUNDEDNESS_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: feedback groundedness is judged',
    detail: 'Is the debrief actually supported by the transcript?',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'FEEDBACK_GROUNDEDNESS_JUDGE__MODEL',
  },
  {
    id: 'rag-quality-judge',
    task: LlmTask.RAG_QUALITY_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Scheduled: corpus retrievals are judged',
    detail:
      'Did the passages retrieved actually answer the query, and what was a short ' +
      'retrieval missing? The similarity floor is calibrated from these labels, because ' +
      'a similarity score is not a measure of usefulness — the character corpus returned ' +
      'nothing for a question one of its own section titles answered.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'RAG_QUALITY_JUDGE__MODEL',
  },
  {
    id: 'recall-quality-judge',
    task: LlmTask.RECALL_QUALITY_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger: "Scheduled: the client's working-memory recall is judged",
    detail:
      'Did the client recall the fact the turn called for, or was it sitting just below the ' +
      "cap? One call per TURN rather than per session, so this family's row count is the " +
      'highest of the six — read its cost against turns, not sessions. Separates a ranking ' +
      'failure (a passed-over fact answered better) from a corpus gap (nothing apt in the ' +
      'pool at all), because those have different fixes.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'RECALL_QUALITY_JUDGE__MODEL',
  },
  {
    id: 'filler-judge',
    task: LlmTask.FILLER_JUDGE,
    runtime: LlmRuntime.ALLY_AI,
    trigger:
      'A super-admin starts a thinking-filler backfill (Analytics: filler quality)',
    detail:
      'Did the filler sound like the character and fit the turn? Manual only: ' +
      'POST /analytics/filler-quality/backfill is its one entry point, and unlike the ' +
      'other judges it is not in the scheduled backlog drainer, so it costs nothing ' +
      'until someone runs it. One call per session that played a filler, plus a free ' +
      'empty-observation probe per run to read the judge version.',
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
      'Answers only from retrieved corpus passages, or declines. Ran on Claude because ' +
      'refusing to answer from outside the passages is an instruction-following problem, ' +
      'until that credential expired and took the bot silent — OpenAI is the one provider ' +
      'whose key is required in that service. Falls back to OpenAI whatever is selected, ' +
      'and says so in the metadata.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
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
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'KNOWLEDGE_AGENT__CRISIS_MODEL',
  },
  {
    id: 'whatsapp-translate-query',
    task: null,
    runtime: LlmRuntime.ALLY_AI,
    trigger: "...and the question isn't in English",
    detail: 'Restates it in English so it embeds against the English corpus.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'KNOWLEDGE_AGENT__TRANSLATE_MODEL',
  },
  {
    id: 'corpus-embedding',
    task: LlmTask.EMBEDDING,
    runtime: LlmRuntime.ALLY_AI,
    trigger: 'Anything is embedded for semantic search',
    detail:
      'Both knowledge corpora (WhatsApp Q&A and the character library, one Weaviate ' +
      'collection each) plus roadmap opportunities — every corpus embeds with THIS model, ' +
      'because a query vector from another model lands in a different space and makes every ' +
      'similarity number meaningless rather than merely worse. 1536 dimensions; Weaviate ' +
      'never vectorises for itself, so this model and those schemas are coupled.',
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
    tier: LlmModelTier.REASONING,
    trigger: 'An author clicks Generate on a simulation field',
    detail:
      'Provider, model and temperature all resolve per prompt. Any of the three ' +
      'providers runs it: the provider follows from the model id, so a prompt row ' +
      'selecting Gemini now works — it used to be silently ignored, because the old ' +
      'autofill pair could only reach OpenAI and Anthropic.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: "the field's own prompt row",
  },
  {
    id: 'autofill-enhance-field',
    task: LlmTask.AUTOFILL_ENHANCE_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger: 'An author clicks Enhance on a field',
    detail:
      "Rewrites the field's current value; unlike Generate it never invents content.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: "the field's own prompt row",
  },
  {
    id: 'autofill-agent-field',
    task: LlmTask.AUTOFILL_AGENT_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger: 'The Agent Builder Copilot generates fields',
    detail:
      'Chained in two stages: challenge description + persona first, from ' +
      'the brief alone; every other field then receives them as ' +
      '`establishedContext` so the fields agree. Within a stage it fans out ' +
      'one abortable call per field, in parallel — and one per ' +
      '(field x language) for the three per-language fields (opening ' +
      'dialogues, style samples, filler words), so a brief naming three ' +
      'spoken languages costs three sets of those. Two further calls are ' +
      'sequenced rather than parallel: `spoken_languages` decides which ' +
      'languages to fan out over, and `language_voices` then casts a voice ' +
      'per language from the voice catalog.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: "the field's own prompt row",
  },
  {
    id: 'autofill-event-field',
    task: LlmTask.AUTOFILL_EVENT_FIELD,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger:
      'An author describes a behaviour in Event Builder and generates a ' +
      'binary-classification event',
    detail:
      'One call per part of the event (classifier, examples, feedback, ' +
      'branch instruction, tags), each from its own prompt row. `classifier` ' +
      'is sequenced first and its class name is fed into the other calls, so ' +
      'the examples describe the class the author kept rather than one the ' +
      'model re-imagined per call. Generates only — nothing is written until ' +
      'the author submits the draft through the normal create/update ' +
      'endpoints.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: "the field's own prompt row",
  },
  {
    id: 'character-interview',
    task: LlmTask.CHARACTER_INTERVIEW,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An author builds a character in the interview agent',
    detail:
      'Streamed turn, capped at 8 tool round-trips; a turn that hits the cap makes one ' +
      'more, tool-less wrap-up call, told when no draft was saved so it cannot announce ' +
      'one. Anthropic, OpenAI and Gemini all run ' +
      'it — the turn loop goes through AgentLlmProviderFactory, and the provider is ' +
      'inferred from the model id when the prompt row does not name one, so setting a ' +
      'model is normally the whole change. `llm_usage` records whichever provider ran.',
    kind: AiTaskKind.COMPLETION,
    // Not a fixed vendor: the interviewer prompt row wins, then
    // CHARACTER_INTERVIEW_PROVIDER, then inference from the model id.
    provider: 'resolved',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'CHARACTER_INTERVIEW_MODEL / CHARACTER_INTERVIEW_PROVIDER',
    promptOverride: 'character_interview_interviewer_system',
    // Keeps a configPath, unlike the tiered rows: this call drives
    // AgentLlmProviderFactory directly rather than going through
    // LlmCompletionService, so `characterInterview.model` is genuinely what it
    // reads. Giving it a tier would make this screen resolve it through a chain
    // its call site does not use, and the two would diverge the moment anyone
    // set CHARACTER_INTERVIEW_MODEL.
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
    tier: LlmModelTier.REASONING,
    trigger: 'A learner submits an answer to a graded open-ended quiz question',
    detail:
      "Graded against the item's rubric. Skipped entirely for a question the trainer marked ungraded.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'track_quiz_open_ended_grading_user',
  },
  {
    id: 'glossary-lexeme-pairing',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'An admin runs bookish-word mining for a language glossary',
    detail:
      'One call per run: pairs up to 40 words the role-play agent over-uses ' +
      "(vs the counsellors' own speech, echoes removed) with colloquial " +
      'equivalents, or keeps them. Manual only, dry-run by default. Goes ' +
      'through LlmProviderFactory, which records no llm_usage — like the ' +
      'other glossary calls, so there is no task label to attach yet.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'prompts.model on glossary_lexeme_pairing',
    promptOverride: 'glossary_lexeme_pairing',
  },
  {
    id: 'track-memory-fold',
    task: LlmTask.TRACK_MEMORY_FOLD,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger: 'A learner finishes a track item',
    detail:
      'Folds per-session memories into one evolving memory per track enrollment.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'its own fold and facts prompt rows',
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
    task: LlmTask.VOICE_NOTE_EXTRACT,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.FAST,
    trigger: '...and the dictation is turned into note fields',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'LLM_FAST_MODEL',
    promptOverride: 'the scribe field-extraction system prompt',
  },
  {
    id: 'coaching-chat',
    task: LlmTask.DEBRIEF_CHAT,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A learner uses coaching chat',
    detail:
      "The learner's chat about their debrief after a roleplay. Streamed. A Gemini " +
      'path exists via @google/genai and is selectable per deployment. Recorded ' +
      "against the session, so it counts toward the roleplay's session cost.",
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'AI_CHAT_OPENAI_MODEL / AI_CHAT_DEFAULT_PROVIDER',
    promptOverride: 'openai_scenario_session_chat',
    configPath: 'aiChat.model',
  },
  {
    id: 'debrief-chat-summary',
    task: LlmTask.DEBRIEF_CHAT_SUMMARY,
    runtime: LlmRuntime.ALLY_BE,
    trigger: '...and the debrief chat history grows long',
    detail:
      'Folds older debrief-chat messages into a running summary so the history ' +
      'sent with each reply stays bounded. Same provider and model as the chat.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'AI_CHAT_OPENAI_MODEL / AI_CHAT_DEFAULT_PROVIDER',
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
    tier: LlmModelTier.REASONING,
    trigger: 'An admin clicks Generate on the Suggestions tab',
    detail:
      'A whole analytics window in, at most ten roadmap suggestions out — the one place a ' +
      'larger model may be worth the latency, so it has its own env var.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'analytics_suggestions_generate',
  },
  {
    id: 'ux-signals',
    task: LlmTask.UX_SIGNALS,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger: 'Scheduled: the UX Signals scan triages PostHog',
    detail:
      'Threshold-crossing detectors become bug findings and roadmap suggestions. Its token ' +
      'profile tracks detector count, not date range.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'ux_signals_triage',
  },
  {
    id: 'foundational-skills-judge',
    task: LlmTask.FOUNDATIONAL_SKILLS_ASSESSMENT,
    runtime: LlmRuntime.ALLY_BE,
    // The call always names FHS_JUDGE_MODEL, which wins the resolution chain;
    // the tier is only the floor LlmTargetResolverService insists on, and
    // neverFallback means it is never actually used (the llm-preview pattern).
    tier: LlmModelTier.REASONING,
    neverFallback: true,
    trigger:
      'Scheduled: a learner crosses another 5,000 characters of roleplay speech',
    detail:
      "Scores one cut of a learner's own practice speech against the fixed foundational " +
      'helping skills rubric (14 skills; non-verbal is not text-assessable) for the Priority tab growth chart. ' +
      'Every 30 min, at most 24 cuts per tick; the first deploy backfills history. The model ' +
      'is pinned in code rather than tier-resolved and never falls back, because the chart ' +
      'compares scores across months and a substituted model would move the whole curve.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy:
      'FHS_JUDGE_MODEL (src/foundational-skills/constants/helping-skills-rubric.constants.ts) — pinned; changing it is a rubric version bump',
  },
  {
    id: 'foundational-skills-benchmark-judge',
    task: LlmTask.FOUNDATIONAL_SKILLS_BENCHMARK_JUDGE,
    runtime: LlmRuntime.ALLY_BE,
    // Pinned exactly like foundational-skills-judge: the call names
    // FHS_JUDGE_MODEL, the tier is only the resolver's floor, and neverFallback
    // keeps a substitute model from ever scoring one end of a before/after pair.
    tier: LlmModelTier.REASONING,
    neverFallback: true,
    trigger:
      'Scheduled: a learner completes a session of a roleplay flagged as the foundational skills benchmark',
    detail:
      'Scores the WHOLE session (helper and client turns, no transcript stored) with the same ' +
      "rubric, judge prompt and pinned model as the cut judge, so a learner's first and latest " +
      'benchmark sessions can be compared on a fixed scenario (Highlights benchmark chart, ' +
      'AAQ-189). Every 30 min, at most 8 sessions per tick, after cut sealing; sessions with ' +
      'under 1,500 characters of learner speech are stored SKIPPED with no call. One call per ' +
      'session per rubric version; failures retry hourly up to 3 attempts. Volume is the number ' +
      'of benchmark sessions taken, typically two per learner.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy:
      'FHS_JUDGE_MODEL (src/foundational-skills/constants/helping-skills-rubric.constants.ts) — pinned, shared with foundational-skills-judge; changing it is a rubric version bump',
  },
  {
    id: 'helpline-qa-judge',
    task: LlmTask.HELPLINE_QA_JUDGE,
    runtime: LlmRuntime.ALLY_BE,
    // Pinned exactly like foundational-skills-judge: the call names
    // FHS_JUDGE_MODEL, the tier is only the resolver's floor, and neverFallback
    // keeps a substitute model from scoring some listeners' chats.
    tier: LlmModelTier.REASONING,
    neverFallback: true,
    trigger: 'Scheduled: a text-helpline chat that a listener took has ended',
    detail:
      "Scores the listener's side of one ended chat against the helping-skills " +
      'rubric (same rubric, pinned model and validation as the cut judge; the prompt ' +
      'frames it as a real text chat rather than a roleplay). Every 30 min, at most 10 ' +
      'chats per tick, 5 min after the end. Chats with fewer than 3 listener messages ' +
      'or 300 listener characters are stored SKIPPED with no call; erased chats are ' +
      'never scored. One call per eligible chat; a failure is retried on later ticks, ' +
      'at most 3 attempts in all. ' +
      'Levels are derived in code, never asked of the model. Off with ' +
      'HELPLINE_QA_SCHEDULE=off.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy:
      'FHS_JUDGE_MODEL (src/foundational-skills/constants/helping-skills-rubric.constants.ts) — pinned, shared with foundational-skills-judge',
  },
  {
    id: 'feedback-improvement-skill-mapping',
    task: LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING,
    runtime: LlmRuntime.ALLY_BE,
    // Pinned like the FHS judges: the call names FEEDBACK_SKILL_MAPPER_MODEL,
    // the tier is only the resolver's floor, and neverFallback keeps a
    // substitute model from filing half the history under different skills.
    tier: LlmModelTier.FAST,
    neverFallback: true,
    trigger:
      "Scheduled: a learner's completed roleplay session has a debrief listing areas of growth",
    detail:
      'Files each improvement the debrief told the learner to work on under ONE of the 14 ' +
      'foundational helping skills, or none, for the Helping skills "named improvements that ' +
      'were acted on" chart (AAQ-221). One call per session, all its improvements batched; ' +
      'temperature 0, JSON mode; stores skill keys by position, never the debrief text. Only ' +
      'settled, countable sessions outside test orgs, of learners who already have a scored ' +
      'helping-skills cut (the only learners the chart can use), oldest first. Every 30 min, ' +
      'at most 20 sessions per tick (960 a day while a backlog clears); failures retry hourly ' +
      'up to 3 attempts; one call per session per mapper version. OFF unless ' +
      'FEEDBACK_SKILL_MAPPING_SCHEDULE=on. A cheap non-reasoning model because this is a short ' +
      'closed-set classification, and pinned because the mapping is stored and compared over ' +
      'time. About 3,000 prompt tokens (2,700 of them the fixed rubric, so a cacheable prefix) ' +
      'and under 100 completion tokens: roughly $0.0005 a call at list price.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy:
      'FEEDBACK_SKILL_MAPPER_MODEL (src/foundational-skills/constants/feedback-skill-mapper.constants.ts) — pinned; changing it is a FEEDBACK_SKILL_MAPPER_VERSION bump',
  },
  {
    id: 'mobile-release-whats-new',
    task: LlmTask.MOBILE_RELEASE_WHATS_NEW,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.FAST,
    trigger: 'An admin drafts App Store "What\'s New" copy',
    detail:
      'Turns ally-mobile commit subjects since the last release into release notes.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'LLM_FAST_MODEL',
    promptOverride: 'mobile_release_whats_new',
  },
  {
    id: 'product-updates-consolidate',
    task: LlmTask.PRODUCT_UPDATES_CONSOLIDATION,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger:
      'Scheduled: every 30 minutes while there are new merges, and in a batch loop during an admin-started backfill',
    detail:
      'One call per batch of up to 30 clustered merges. Places each cluster as a new product ' +
      'update, onto an open one, or as noise, and writes its public and team text. The only ' +
      'model output that reaches the public changelog, so the reply is validated field by ' +
      'field and anything unverifiable goes back to the queue. JSON mode. The prompt row ' +
      'starts on openai/gpt-5 (its _meta sidecar default): side by side on real journal ' +
      'weeks the tier default wrote noticeably more jargon into public text. The tier model ' +
      'below is the fallback if the prompt model fails.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'product_updates_consolidate',
  },
  {
    id: 'changelog-journal-draft',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger:
      "Every merge to a release branch, in ally-changelog's append-entry.yml (GitHub Actions)",
    detail:
      'Drafts the one-line note on each entry of the per-merge journal (CHANGELOG.md). Runs in ' +
      'ally-changelog, not in this service, so it records no llm_usage. Product updates read the ' +
      'note as context; the public changelog is built from those updates, not from this line.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy:
      'MODEL in ally-changelog/.github/scripts/append_entry.py, keyed by the GEMINI_API_KEY secret of that repo',
  },
  {
    id: 'roadmap-ai',
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    trigger:
      'Someone files a roadmap opportunity (the guided interview), or the board classifies, de-duplicates or assesses one',
    detail:
      'Interview turns — the only way to file an opportunity — plus goal classification, the ' +
      "duplicate check's confirmation pass, goal-impact assessment, interview-note summaries, " +
      "Claude-prompt generation, and the Builder drawer's split/merge guard. The standalone " +
      'readiness check, review and enhance calls were removed with the blank filing form.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'LLM_REASONING_MODEL',
    promptOverride: 'the prompt row for each roadmap call',
  },
  {
    id: 'ai-lab-run',
    task: LlmTask.AI_LAB_RUN,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.REASONING,
    // The one task that must never be served by a substitute. An AI Lab run is
    // a deliberate test of one named model; answering from a different one
    // would make the whole feature lie about what it measured.
    neverFallback: true,
    trigger: 'An admin runs a skill in AI Lab',
    detail:
      'Model comes from the skill row and the provider is inferred from it. OpenAI and ' +
      'Anthropic only — anything else throws rather than silently substituting.',
    kind: AiTaskKind.COMPLETION,
    provider: 'resolved',
    defaultModel: 'gpt-5-mini',
    configuredBy: 'lab_skills.model, else LLM_REASONING_MODEL',
  },
  {
    id: 'llm-preview',
    task: LlmTask.LLM_PREVIEW,
    runtime: LlmRuntime.ALLY_BE,
    tier: LlmModelTier.FAST,
    // A preview answered by a substitute would report a model as working that
    // nobody tested — worse than an error, because it is believed.
    neverFallback: true,
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
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUG_HUNTER_CLASSIFY_REPO_MODEL (compiled in)',
  },
  {
    id: 'bug-hunter-miss-classifier',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A person reports a bug, or edits its description',
    detail:
      'Writes why Bug Hunter did not find the bug first and which sense would have (OPP-0774). One cheap JSON answer per report, never on the request path.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUG_HUNTER_CLASSIFY_MISS_MODEL (compiled in)',
  },
  {
    id: 'bug-hunter-decider',
    task: LlmTask.BUG_HUNTER,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'Bug Hunter plans a sweep or triages a new finding',
    detail:
      'Picks from a closed menu over the scoreboard with a one-line reason: which senses (D1), which model (D2), verify/hold/drop a finding (D3). The rule always answers too; the pick not taken is logged (OPP-0781).',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUG_HUNTER_DECIDE_MODEL (compiled in)',
  },
  {
    id: 'agent-memory-curation',
    task: LlmTask.AGENT_MEMORY_CURATION,
    runtime: LlmRuntime.ALLY_BE,
    // Mechanical editing of short entries against a fixed operation set: cost
    // and time dominate, and a wrong merge is caught by the next pass.
    tier: LlmModelTier.FAST,
    trigger: "Hourly, when an agent's notebook has new candidate entries",
    detail:
      'Folds the notes a sweep or fix session wrote into the curated active set: agree, ' +
      'edit, add or remove, one operation per candidate. Bug Hunter today; Builder when ' +
      'its lessons move to the same table.',
    kind: AiTaskKind.COMPLETION,
    provider: 'openai',
    defaultModel: 'gpt-4o-mini',
    configuredBy: 'LLM_FAST_MODEL',
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
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
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
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
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
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-epic-decomposition',
    task: LlmTask.BUILDER_EPIC_DECOMPOSITION,
    runtime: LlmRuntime.ALLY_BE,
    trigger: 'A large PRD is cut into milestones',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
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
      'Planner and verifier run on gemini-2.5-pro. Usage is reported back by the runner.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
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
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-outcome-categorise',
    task: LlmTask.BUILDER_OUTCOME_CATEGORISE,
    runtime: LlmRuntime.ALLY_BE,
    trigger: '...and how the run turned out is categorised',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-context-selection',
    task: LlmTask.BUILDER_CONTEXT_SELECTION,
    runtime: LlmRuntime.ALLY_BE,
    // Deliberately NOT tiered: the call site names `builder.mechanicalModel`
    // explicitly, so the choice a tier exists to make has already been made,
    // and `configPath` below is the truth about what serves this task.
    //
    // Until 2026-09-23 this row nonetheless failed on every single run —
    // `callConfigForAiTask` demanded a tier from every caller, whether or not
    // one was needed — and failed quietly: every Builder build logged
    // "Exemplar re-rank failed, falling back to most recent" and carried on,
    // so the relevance ranking this row exists to perform had never once
    // happened in production. A build silently handed the most RECENT
    // exemplars instead of the most RELEVANT ones looks exactly like a build
    // that got good ones.
    trigger: 'A new session picks which past lessons to see',
    detail: "Lesson and exemplar selection for the next run's context.",
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    configuredBy: 'BUILDER_MECHANICAL_MODEL',
    configPath: 'builder.mechanicalModel',
  },
  {
    id: 'builder-repo-map',
    // Records no usage: the runner posts the finished map to
    // pipeline/repo-maps, and that endpoint takes no cost.
    task: null,
    runtime: LlmRuntime.ALLY_BE,
    trigger: "A weekly job rewrites each repo's map for Builder",
    detail:
      'Sundays 03:00 UTC, one agentic opencode run per repo (five) in ' +
      '.github/workflows/builder-context-refresh.yml via scripts/builder/refresh-repo-map.sh. ' +
      'The map is what the interview and every build phase read before opening files.',
    kind: AiTaskKind.COMPLETION,
    provider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    configuredBy: 'BUILDER_MAP_MODEL (scripts/builder/refresh-repo-map.sh)',
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
    configuredBy:
      'GlobalSettings (bug_hunter.models.defaultModel) via GET pipeline/models, read by .github/workflows/bug-hunt-sweep.yml',
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
    configuredBy:
      'GlobalSettings (bug_hunter.models.defaultModel) via GET pipeline/models, read by .github/workflows/bug-fix-session.yml',
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
    configuredBy:
      'GlobalSettings (bug_hunter.models.escalationModel) via GET pipeline/models, written into .claude/agents/bug-escalation.md (model:) at runtime',
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

/**
 * Everything `LlmCompletionService` needs from a task's registry row.
 *
 * Returned together, and deliberately not as two lookups. `neverFallback` used
 * to be fetched separately and was simply never wired in, so the two rows that
 * set it — the AI Lab run and the LLM preview, the two calls whose whole point
 * is testing ONE named model — silently fell back anyway. A preview then
 * reported `ok: true` for a model that does not exist, having quietly tested a
 * different one. One lookup makes forgetting the second field impossible.
 *
 * Throws rather than defaulting for an unknown id. A caller reaching here with
 * a taskId that has no row is a call with no registry entry — the exact gap the
 * CI guards exist to close — and quietly serving it the cheap tier would hide
 * that instead of surfacing it.
 */
export interface AiTaskCallConfig {
  /** Absent when the caller named its own model — see callConfigForAiTask. */
  tier?: LlmModelTier;
  /** True when a substitute model would make the result a lie, not a degradation. */
  neverFallback: boolean;
}

export const callConfigForAiTask = (
  taskId: string,
  options: {
    /**
     * True when the caller passed a concrete model. A tier exists to CHOOSE a
     * model, so a call that has already chosen needs none — and demanding one
     * broke every config-selected row that went through `LlmCompletionService`.
     * `builder-context-selection` names `builder.mechanicalModel` at its call
     * site and was refused on every Builder run for want of a tier it would
     * never have consulted.
     *
     * `neverFallback` still comes from the row either way: whether a substitute
     * would make the result a lie is a property of the task, not of who picked
     * the model.
     */
    modelIsExplicit?: boolean;
  } = {},
): AiTaskCallConfig => {
  const entry = AI_TASK_REGISTRY.find((row) => row.id === taskId);
  if (!entry?.tier && !options.modelIsExplicit) {
    throw new Error(
      `AI task "${taskId}" has no tier in the AI task registry, and the call ` +
        `named no model of its own. Add a row (or a tier to the existing one) ` +
        `in ai-task-registry.constants.ts.`,
    );
  }
  return { tier: entry?.tier, neverFallback: Boolean(entry?.neverFallback) };
};

/** The tier alone, for callers that only need a default model. */
export const tierForAiTask = (taskId: string): LlmModelTier =>
  // Non-null: called without `modelIsExplicit`, so a missing tier has already
  // thrown above rather than reaching here.
  callConfigForAiTask(taskId).tier!;
