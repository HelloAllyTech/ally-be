/**
 * Scenario fields that support the studio "Enhance" action — a field-level
 * refinement that takes ONLY the field's *existing* content and improves it
 * (auto, or per a custom instruction). Deliberately separate from
 * {@link GeneratableField} (auto-generate from scratch): enhance never invents
 * content, it only rewrites what the author already has.
 *
 * To add a new enhanceable field: add an entry here and a label below, then
 * wire the `enhanceType` config + `<EnhanceButton>` on the studio side. The
 * prompt lives in Prompt Management (`enhance_field` / `enhance_state`), so no
 * code change is needed to tweak wording.
 */
export enum EnhanceableField {
  ROLE_INSTRUCTION = 'roleInstruction',
  CHARACTER_PROFILE_TEXT = 'characterProfileText',
  DESCRIPTION = 'description',
  OPENING_STATEMENTS = 'openingStatements',
  LINGUISTIC_STYLE_SAMPLES = 'linguisticStyleSamples',
  ALLOWED_FILLER_WORDS = 'allowedFillerWords',
  KNOWLEDGE_SOURCES = 'knowledgeSources',
  /** Structured: improves a simulation state's name AND guidelines together. */
  STATE = 'state',
}

/**
 * Human-readable description of each field, injected into the enhance prompt
 * so the model knows what it is improving and what good looks like for that
 * field. Keep these phrased as "what this field is".
 */
export const ENHANCEABLE_FIELD_LABELS: Record<EnhanceableField, string> = {
  [EnhanceableField.ROLE_INSTRUCTION]:
    'Role instruction — the directive that tells the AI how to stay in ' +
    'character as the client during the roleplay.',
  [EnhanceableField.CHARACTER_PROFILE_TEXT]:
    'Character backstory — the life history and personality of the AI client ' +
    'persona.',
  [EnhanceableField.DESCRIPTION]:
    'Challenge description — the primary learning goal / situation the ' +
    'counselor is practicing.',
  [EnhanceableField.OPENING_STATEMENTS]:
    'Opening dialogues — the first lines the AI client says to open the ' +
    'session. One dialogue line per text line.',
  [EnhanceableField.LINGUISTIC_STYLE_SAMPLES]:
    'Linguistic style samples — example sentences showing how the AI client ' +
    'speaks (vocabulary, tone, rhythm). One sample per line. Keep them in the ' +
    'same language as the input.',
  [EnhanceableField.ALLOWED_FILLER_WORDS]:
    'Allowed filler words — short hesitation/filler words or phrases the AI ' +
    'client may use (e.g. "um", "you know"). One per line. Keep them in the ' +
    'same language as the input.',
  [EnhanceableField.KNOWLEDGE_SOURCES]:
    'Knowledge source document — self-contained reference content the AI ' +
    'client can draw on, written in second person ("You ...").',
  [EnhanceableField.STATE]:
    'Simulation state — a short name and the guidelines injected into the prompt ' +
    'while this state is active.',
};

/**
 * Prompt-Management codes for the enhance prompts (file-backed at
 * src/prompts/enhance_field.txt and src/prompts/enhance_state.txt, editable in
 * the Prompt Management UI). The generic one serves every plain-text field via
 * the {{fieldLabel}} variable; the state one is structured (JSON name+guidelines).
 */
export const ENHANCE_FIELD_PROMPT_CODE = 'enhance_field';
export const ENHANCE_STATE_PROMPT_CODE = 'enhance_state';
