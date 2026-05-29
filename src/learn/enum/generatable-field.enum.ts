export enum GeneratableField {
  STATE_INSTRUCTIONS = 'stateInstructions',
  OPENING_STATEMENTS = 'openingStatements',
  DESCRIPTION = 'description',
  CHARACTER_PROFILE_TEXT = 'characterProfileText',
  BEHAVIOR_INSTRUCTIONS = 'behaviorInstructions',
  LINGUISTIC_STYLE_SAMPLES = 'linguisticStyleSamples',
  ALLOWED_FILLER_WORDS = 'allowedFillerWords',
  /** Per-simulation states for main-agent prompts with `hasStates: true`. */
  STATES = 'states',
  /** Per-simulation knowledge source documents that feed RAG retrieval. */
  KNOWLEDGE_SOURCES = 'knowledgeSources',
}
