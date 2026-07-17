/**
 * The Roleplay Studio v2 spec document — the FROZEN cross-repo contract
 * (schema version "1.0") shared with ally-ai (actor/director runtime and the
 * rehearsal harness) and ally-web (studio editor).
 *
 * Stored verbatim as jsonb in roleplay_specs.draftSpec and
 * roleplay_spec_versions.spec. `ui` is an opaque client-owned block: the
 * backend passes it through untouched and never validates beyond "is an
 * object".
 */
export const SPEC_SCHEMA_VERSION = '1.0';

export interface PersonaChunk {
  id: string;
  topics: string[];
  content: string;
}

export interface RoleplayPersona {
  identityCore: string;
  scenarioContext: string;
  chunks: PersonaChunk[];
}

export interface StateTransition {
  id: string;
  toStateId: string;
  description?: string;
  whenBehaviorsAny?: string[];
  whenBehaviorsAll?: string[];
  minTurnsInState?: number;
  minCumulativeScore?: number;
}

export interface RoleplayState {
  id: string;
  name: string;
  emotionalRegister?: string;
  disclosurePosture?: string;
  resistanceLevel?: number | string;
  stateCard?: string;
  defaultStageDirection?: string;
  prosodyHints?: string[];
  transitions?: StateTransition[];
}

export interface RoleplayStateMachine {
  initialStateId: string;
  states: RoleplayState[];
}

export interface DisclosureSecret {
  id: string;
  topic: string;
  content: string;
  unlockConditions?: string | string[];
  minStateIds?: string[];
  lockedDeflection?: string;
  tier?: number | string;
}

export interface DisclosureLedger {
  secrets: DisclosureSecret[];
}

export interface RubricBehavior {
  id: string;
  name: string;
  description?: string;
  polarity: 'helpful' | 'unhelpful';
  weight?: number;
  examples?: string[];
}

export interface RoleplayRubric {
  behaviors: RubricBehavior[];
}

export interface EngineeredEvent {
  id: string;
  name: string;
  trigger: 'time' | 'behavior' | 'score';
  atSeconds?: number;
  behaviorIds?: string[];
  scoreThreshold?: number;
  /**
   * For score-triggered events: fire when the trainee's cumulative score sinks
   * to/below the threshold ('at_or_below', the default) or rises to/above it
   * ('at_or_above', a positive-reinforcement beat). Optional & additive; the
   * runtime defaults to 'at_or_below' when omitted.
   */
  scoreComparison?: 'at_or_below' | 'at_or_above';
  direction?: string;
  once?: boolean;
}

export interface RoleplayVoiceConfig {
  /** languageId (stringified number key in jsonb) → scenario_voices.id */
  languageVoices: Record<string, string>;
}

export interface RoleplayLanguageConfig {
  languageId: number;
  languageCode: string;
}

export interface RoleplayModelConfig {
  provider: string;
  config?: Record<string, any>;
}

export interface RoleplaySpecDocument {
  specSchemaVersion: string;
  title: string;
  /**
   * Primary competency (kept for backward-compat / the thin scenario shell).
   * Derived from `competencyIds[0]` when the multi-select is used.
   */
  competencyId?: string;
  /** All competencies this spec trains (first-class multi-select). */
  competencyIds?: string[];
  /**
   * Competency display names, index-aligned with `competencyIds`. Written by
   * the copilot (it already has id→name from get_competencies) and passed
   * through to the runtime so the actor/director/trainee prompts can name the
   * competencies without a DB lookup.
   */
  competencyNames?: string[];
  persona: RoleplayPersona;
  stateMachine: RoleplayStateMachine;
  disclosureLedger: DisclosureLedger;
  rubric: RoleplayRubric;
  engineeredEvents?: EngineeredEvent[];
  voice: RoleplayVoiceConfig;
  language: RoleplayLanguageConfig;
  agentTestCaseIds?: string[];
  openingStatement?: string;
  difficulty?: string;
  /**
   * Voice-naturalness / latency-masking runtime toggles, mirroring the Roleplay
   * Studio 1 scenario-metadata flags. Passthrough JSONB → compiled spec → room
   * metadata `spec.*`, honored by the v2 voice worker (ally-ai-learn).
   */
  fillerEnabled?: boolean;
  comfortAudioEnabled?: boolean;
  /** Public URL of the selected comfort-audio track (comfort-audio library). */
  comfortAudioUrl?: string;
  /** Comfort-audio playback volume (0..1); falls back to the global default when unset. */
  comfortAudioVolume?: number;
  continuousBackchanneling?: boolean;
  interimReplyEnabled?: boolean;
  /**
   * Optional Studio-authored static thinking-filler phrases. When empty, the
   * v2 runtime falls back to a neutral default set. Additive passthrough.
   */
  fillerPhrases?: string[];
  actorModel?: RoleplayModelConfig;
  directorModel?: RoleplayModelConfig;
  /** Opaque client-owned block — passthrough, never validated. */
  ui?: Record<string, any>;
}

/** One structured problem found by SpecValidatorService. */
export interface SpecValidationError {
  /** JSON-pointer-ish location, e.g. "/stateMachine/states/2/transitions/0/toStateId". */
  path: string;
  /** Stable machine code, e.g. "dangling_reference". */
  code: string;
  message: string;
}

export interface SpecValidationResult {
  valid: boolean;
  errors: SpecValidationError[];
}
