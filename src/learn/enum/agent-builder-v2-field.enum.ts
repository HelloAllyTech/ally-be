/**
 * The Basic Settings fields the Agent Builder Copilot V2 generates, each from
 * its OWN editable prompt template (src/prompts/agent_builder_v2/*.txt) fired as
 * an independent parallel LLM call. The string values double as the prompt-file
 * basename (via toPromptCode('agent_builder_v2', <basename>)).
 *
 * Distinct from {@link GeneratableField} (the studio's per-field regenerate set)
 * on purpose: V2 is driven by the free-text actor brief + competency +
 * optimisation goals, not by an already-populated scenario, so it has its own
 * prompt codes, variables, and output parsing.
 */
export enum AgentBuilderV2Field {
  ROLE_INSTRUCTION = 'role_instruction',
  TITLE = 'title',
  CHALLENGE_DESCRIPTION = 'challenge_description',
  KNOWLEDGE_SOURCES = 'knowledge_sources',
  PERSONA = 'persona',
}
