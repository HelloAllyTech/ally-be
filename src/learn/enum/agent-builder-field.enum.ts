/**
 * The Basic Settings fields the Agent Builder Copilot generates, each from its
 * OWN editable prompt template (src/prompts/agent_builder/*.txt) fired as an
 * independent parallel LLM call. The string values double as the prompt-file
 * basename (via toPromptCode('agent_builder', <basename>)).
 *
 * Distinct from the removed generate/regenerate feature (the studio's per-field regenerate set)
 * on purpose: the copilot is driven by the free-text actor brief + competency +
 * agent test cases, not by an already-populated scenario, so it has its own
 * prompt codes, variables, and output parsing.
 */
export enum AgentBuilderField {
  ROLE_INSTRUCTION = 'role_instruction',
  TITLE = 'title',
  CHALLENGE_DESCRIPTION = 'challenge_description',
  KNOWLEDGE_SOURCES = 'knowledge_sources',
  PERSONA = 'persona',
  // Character backstory (characterProfileText) — the hard biographical facts
  // the Role Instruction deliberately omits. Plain text, same 3 inputs as
  // every other field; not sequenced after persona (see generateAgentBuilderField).
  BACKSTORY = 'backstory',
  // Per-simulation score-driven states (metadata.states). Only meaningful for
  // main-agent prompts that reference {state_x_guidelines}; the studio wizard
  // fires this field ONLY when such a variant is selected. The model supplies
  // ordered {name, guidelines, ragEnabled}; the server assigns stable ids and
  // the contiguous score bands (see buildGeneratedStates).
  STATES = 'states',
  // First lines the client might say to open the session. Plain text, one
  // line per opening statement. LANGUAGE-SCOPED (see below).
  OPENING_STATEMENTS = 'opening_statements',
  // Short in-session coaching nudges shown to the learner (not the actor).
  // Plain text, one line per reminder.
  REMINDERS = 'reminders',
  // Example sentences showing how the client speaks. LANGUAGE-SCOPED: generated
  // once per language the brief says the client speaks, written natively in
  // that language rather than translated from the English set.
  LINGUISTIC_STYLE_SAMPLES = 'linguistic_style_samples',
  // Hesitation/filler words for the voice agent. LANGUAGE-SCOPED, same as
  // LINGUISTIC_STYLE_SAMPLES.
  ALLOWED_FILLER_WORDS = 'allowed_filler_words',
  // One voice per spoken language, cast from the studio's voice catalog against
  // the brief + the generated persona. Not a Basic Settings text field: the
  // wizard fires it after `spoken_languages` and `persona`, and its answer
  // fills the mandatory Language-Voice mapping.
  LANGUAGE_VOICES = 'language_voices',
  // Which of the platform's languages the actor brief says the client speaks
  // ("Suchi speaks English, Hindi and Marathi" -> those three). Not a Basic
  // Settings field: the wizard fires this FIRST and uses the answer to fan the
  // language-scoped fields out one call per language.
  SPOKEN_LANGUAGES = 'spoken_languages',
}

/**
 * The fields generated once PER LANGUAGE the client speaks, each written
 * natively in that language. Every other field is language-agnostic (or
 * English-only prose the studio translates elsewhere) and is generated once.
 */
export const LANGUAGE_SCOPED_AGENT_BUILDER_FIELDS: ReadonlySet<AgentBuilderField> =
  new Set([
    AgentBuilderField.OPENING_STATEMENTS,
    AgentBuilderField.LINGUISTIC_STYLE_SAMPLES,
    AgentBuilderField.ALLOWED_FILLER_WORDS,
  ]);

export const isLanguageScopedAgentBuilderField = (
  field: AgentBuilderField,
): boolean => LANGUAGE_SCOPED_AGENT_BUILDER_FIELDS.has(field);

/**
 * Safety valve on the wizard's fan-out: however many languages the model
 * names, only this many are generated (3 fields x N languages of LLM calls).
 */
export const MAX_SPOKEN_LANGUAGES = 6;
