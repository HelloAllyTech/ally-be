/**
 * Declarative shape of a provider's `config` jsonb, shared by every
 * provider-backed registry: TTS voices, STT configs and LLM configs.
 *
 * All three answer the same question — "which provider, which model, and what
 * provider-specific parameters" — so they get one field-schema type, one
 * validator, and (on the admin dashboard) one form renderer. Adding a provider
 * or a parameter is then a data edit in one place rather than a new DTO, a new
 * validator branch and a new block of JSX.
 *
 * The schemas themselves stay per-service, because the runtimes genuinely
 * differ: `ally-ai-learn/app/tts/*.py`, `app/stt/factory.py` and
 * `app/llms/factory.py` each accept a different provider set and read different
 * keys. Only the machinery is shared.
 */
export interface ProviderConfigField {
  key: string;
  required: boolean;
  /** Legacy spellings accepted on read, e.g. ElevenLabs `voiceId`. */
  aliases?: string[];
  type: 'string' | 'boolean' | 'number';
  /** When set, the value must be one of these. */
  options?: string[];
  /** Inclusive bounds for `type: 'number'`. */
  min?: number;
  max?: number;
}

/** provider (as stored) → the fields that provider's client reads. */
export type ProviderConfigSchema = Record<string, ProviderConfigField[]>;

/**
 * Read a field's value, tolerating the legacy spellings in `aliases`. Empty
 * string counts as absent — a blank input should read as "not set", not as a
 * value the provider will choke on.
 */
export const readConfigField = (
  config: Record<string, unknown>,
  field: ProviderConfigField,
): unknown => {
  for (const key of [field.key, ...(field.aliases ?? [])]) {
    const value = config[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
};

/**
 * Validate a provider config against its schema.
 *
 * Unknown keys are tolerated on purpose: seeded rows carry redundant extras
 * (Google voices have a stray `languageCode`), and rejecting them would make
 * those rows uneditable. Only missing required fields and wrong-typed /
 * out-of-range values are errors.
 *
 * Provider lookup is case-insensitive in both directions because the three
 * registries disagree on casing — `scenario_voices` stores 'GOOGLE' while
 * `stt_configs` stores 'google'.
 *
 * @returns human-readable error messages; empty when the config is valid.
 */
export interface ProviderConfigLabels {
  /** Used in messages, e.g. "STT config" / "voice". */
  subject: string;
  /** Overrides the derived supported-provider list in the unsupported message. */
  supported?: string[];
  /**
   * Wording for a missing required field. Provided so each registry can keep
   * the phrasing its UI and tests already use, without forking the validator.
   */
  requiredMessage?: (provider: string, key: string) => string;
  /** Wording for a non-object config. */
  notAnObjectMessage?: string;
}

export const validateProviderConfig = (
  schema: ProviderConfigSchema,
  provider: string | undefined | null,
  config: Record<string, unknown> | undefined | null,
  labels: ProviderConfigLabels = { subject: 'config' },
): string[] => {
  const lookup = String(provider ?? '').toLowerCase();
  const matchedKey = Object.keys(schema).find(
    (key) => key.toLowerCase() === lookup,
  );
  const fields = matchedKey ? schema[matchedKey] : undefined;

  if (!fields || matchedKey === undefined) {
    const supported = labels.supported ?? Object.keys(schema);
    return [
      `Unsupported ${labels.subject} provider "${provider}". ` +
        `Supported providers: ${supported.join(', ')}.`,
    ];
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [
      labels.notAnObjectMessage ??
        `${labels.subject} config must be a JSON object.`,
    ];
  }

  const errors: string[] = [];

  for (const field of fields) {
    const value = readConfigField(config, field);

    if (value === undefined) {
      if (field.required) {
        errors.push(
          labels.requiredMessage
            ? labels.requiredMessage(matchedKey, field.key)
            : `${matchedKey} ${labels.subject} requires "${field.key}" in config.`,
        );
      }
      continue;
    }

    if (field.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`"${field.key}" must be true or false.`);
      continue;
    }

    if (field.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`"${field.key}" must be a number.`);
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        errors.push(`"${field.key}" must be at least ${field.min}.`);
        continue;
      }
      if (field.max !== undefined && value > field.max) {
        errors.push(`"${field.key}" must be at most ${field.max}.`);
        continue;
      }
    }

    if (field.type === 'string' && typeof value !== 'string') {
      errors.push(`"${field.key}" must be a string.`);
      continue;
    }

    if (field.options && !field.options.includes(value as string)) {
      errors.push(
        `"${field.key}" must be one of: ${field.options.join(', ')}.`,
      );
    }
  }

  return errors;
};
