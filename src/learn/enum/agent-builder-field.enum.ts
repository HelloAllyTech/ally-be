/**
 * The Basic Settings fields the Agent Builder Copilot generates, each from its
 * OWN editable prompt template (src/prompts/agent_builder/*.txt) fired as an
 * independent parallel LLM call. The string values double as the prompt-file
 * basename (via toPromptCode('agent_builder', <basename>)).
 *
 * Distinct from {@link GeneratableField} (the studio's per-field regenerate set)
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
}
