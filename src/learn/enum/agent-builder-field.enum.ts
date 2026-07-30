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
  // line per opening statement.
  OPENING_STATEMENTS = 'opening_statements',
  // Short in-session coaching nudges shown to the learner (not the actor).
  // Plain text, one line per reminder.
  REMINDERS = 'reminders',
  // Example sentences showing how the client speaks. Generated for English
  // only (id "1") — the wizard has no language-selection step to key off of;
  // the trainer can add other languages manually afterwards.
  LINGUISTIC_STYLE_SAMPLES = 'linguistic_style_samples',
  // Hesitation/filler words for the voice agent. Generated for English only
  // (id "1"), same reasoning as LINGUISTIC_STYLE_SAMPLES.
  ALLOWED_FILLER_WORDS = 'allowed_filler_words',
}
