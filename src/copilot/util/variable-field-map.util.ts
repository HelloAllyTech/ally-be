import { GeneratableField } from 'src/learn/enum/generatable-field.enum';

/**
 * Maps a main-agent prompt's `availableVariables` (placeholder names) to the
 * structured Basic Settings fields a per-field generator can author. Only
 * fields whose variable is referenced by the selected skill are generated
 * ("only generate fields mapped to the skill").
 *
 * The prose core of the actor — role instruction (`prompt`), title, persona
 * demographics, challenge description, character backstory, opening
 * statements — is produced by the agent-builder meta call (there is no
 * per-field generator for the role instruction), so those variables are NOT
 * listed here. This map covers only the STRUCTURED fields that have a
 * dedicated `generateField` generator and benefit from one.
 */
const STRUCTURED_FIELD_VARIABLES: ReadonlyArray<{
  field: GeneratableField;
  /** Any one of these placeholder names in the skill enables this field. */
  variables: string[];
}> = [
  {
    field: GeneratableField.LINGUISTIC_STYLE_SAMPLES,
    variables: ['linguistic_samples', 'linguistic_style_samples', 'samples'],
  },
  {
    field: GeneratableField.ALLOWED_FILLER_WORDS,
    variables: ['allowed_fillers', 'allowed_filler_words'],
  },
  {
    field: GeneratableField.BEHAVIOR_INSTRUCTIONS,
    variables: [
      'behavior_instructions_json',
      'helpful_behaviours',
      'unhelpful_behaviours',
    ],
  },
  {
    field: GeneratableField.KNOWLEDGE_SOURCES,
    variables: ['retrieved_context', 'knowledge_sources'],
  },
];

/**
 * Dependency tiers for the structured fields. Fields within a tier are
 * independent (run in parallel); each tier consumes the outputs of prior
 * tiers (the actor's character backstory / description / competency from the
 * agent-builder base call, plus — for STATES / KNOWLEDGE_SOURCES — the
 * behaviour context generated in tier 1).
 */
const STRUCTURED_FIELD_TIERS: ReadonlyArray<GeneratableField[]> = [
  [
    GeneratableField.LINGUISTIC_STYLE_SAMPLES,
    GeneratableField.ALLOWED_FILLER_WORDS,
    GeneratableField.BEHAVIOR_INSTRUCTIONS,
  ],
  [GeneratableField.STATES, GeneratableField.KNOWLEDGE_SOURCES],
];

/**
 * Normalize a skill prompt's `availableVariables` (which may be bare strings
 * or `{name, label?, required?}` objects) into a set of placeholder names.
 */
export function extractAvailableVariableNames(
  availableVariables:
    | ReadonlyArray<
        string | { name?: string; label?: string; required?: boolean }
      >
    | null
    | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const entry of availableVariables ?? []) {
    if (typeof entry === 'string') {
      if (entry.trim()) names.add(entry.trim());
    } else if (entry && typeof entry.name === 'string' && entry.name.trim()) {
      names.add(entry.name.trim());
    }
  }
  return names;
}

/**
 * Compute the ordered tiers of structured fields to generate for a skill.
 *
 * @param availableVariableNames placeholder names referenced by the skill prompt
 * @param hasStates whether the skill is a `hasStates` main-agent variant
 * @returns tiers of fields (parallel within a tier, sequential across tiers),
 *          with empty tiers dropped
 */
export function planStructuredGeneration(
  availableVariableNames: Set<string>,
  hasStates: boolean,
): GeneratableField[][] {
  const enabled = new Set<GeneratableField>();
  for (const { field, variables } of STRUCTURED_FIELD_VARIABLES) {
    if (variables.some((v) => availableVariableNames.has(v))) {
      enabled.add(field);
    }
  }
  // STATES is gated by the prompt's hasStates flag, not an availableVariable.
  if (hasStates) {
    enabled.add(GeneratableField.STATES);
  }

  return STRUCTURED_FIELD_TIERS.map((tier) =>
    tier.filter((field) => enabled.has(field)),
  ).filter((tier) => tier.length > 0);
}
