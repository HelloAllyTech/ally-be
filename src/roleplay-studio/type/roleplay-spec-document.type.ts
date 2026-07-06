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
  competencyId?: string;
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
