import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates a `Record<languageId, sttConfigId>` map — the same shape as
 * `languageVoices`, pointing at stt_configs rows rather than scenario_voices.
 *
 * class-validator has no built-in for the values of a keyed map, and getting
 * this wrong is not cosmetic: a junk key means the override silently never
 * applies (it is looked up by language id), and a junk value means the session
 * quietly falls back to the language default. Both look like "the setting
 * didn't work" with nothing in the logs.
 */
@ValidatorConstraint({ name: 'isConfigIdByLanguage', async: false })
export class IsConfigIdByLanguageConstraint implements ValidatorConstraintInterface {
  private failure = 'must be a map of language id to STT config id';

  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;

    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value instanceof Date
    ) {
      this.failure = 'must be an object keyed by language id';
      return false;
    }

    for (const [languageId, configId] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!/^\d+$/.test(languageId)) {
        this.failure = `"${languageId}" is not a valid language id`;
        return false;
      }

      // A cleared row is sent as null (or an empty string, which is what an
      // unset dropdown produces) so the language falls back to its own default.
      if (configId === null || configId === '') continue;

      if (typeof configId !== 'string' || !UUID_PATTERN.test(configId)) {
        this.failure = `language ${languageId} must reference an STT config id`;
        return false;
      }
    }

    return true;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `${args?.property ?? 'config map'} ${this.failure}`;
  }
}
