import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT } from '../constants/scenario-character.constants';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Matches the varchar the column used to be, and the character form's cap. */
const MAX_LANGUAGE_CHARACTERISTICS_LENGTH = 1000;
const MAX_SAMPLE_LENGTH = 300;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

/**
 * Validators for the character's per-language maps.
 *
 * These exist because going per-language moved the limits out of reach of the
 * per-property decorators that enforced them: `@MaxLength(1000)` and
 * `@ArrayMaxSize` describe a string and an array, and say nothing about the
 * values inside `Record<languageId, …>`. Leaving them off would have quietly
 * dropped every length limit the column and the form still assume — a
 * 5,000-char style string persists happily in jsonb and only surfaces later,
 * in a form that will not show it or a down-migration that truncates it.
 */

@ValidatorConstraint({ name: 'isVoiceIdByLanguage', async: false })
export class IsVoiceIdByLanguageConstraint implements ValidatorConstraintInterface {
  private failure = 'must be a map of language id to voice id';

  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (!isPlainObject(value)) {
      this.failure = 'must be an object keyed by language id';
      return false;
    }

    for (const [languageId, voiceId] of Object.entries(value)) {
      if (!/^\d+$/.test(languageId)) {
        this.failure = `"${languageId}" is not a valid language id`;
        return false;
      }
      // Whether the voice exists, and whether it belongs to THIS language, is
      // checked against the catalog in the service — a DTO cannot know.
      if (typeof voiceId !== 'string' || !UUID_PATTERN.test(voiceId)) {
        this.failure = `language ${languageId} must reference a voice id`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `${args?.property ?? 'voices'} ${this.failure}`;
  }
}

@ValidatorConstraint({ name: 'isStyleTextByLanguage', async: false })
export class IsStyleTextByLanguageConstraint implements ValidatorConstraintInterface {
  private failure = 'must be a map of language id to style guidance';

  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (!isPlainObject(value)) {
      this.failure = 'must be an object keyed by language id';
      return false;
    }

    for (const [languageId, text] of Object.entries(value)) {
      if (!/^\d+$/.test(languageId)) {
        this.failure = `"${languageId}" is not a valid language id`;
        return false;
      }
      if (typeof text !== 'string') {
        this.failure = `language ${languageId} must map to text`;
        return false;
      }
      if (text.length > MAX_LANGUAGE_CHARACTERISTICS_LENGTH) {
        this.failure =
          `language ${languageId} exceeds ` +
          `${MAX_LANGUAGE_CHARACTERISTICS_LENGTH} chars`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `${args?.property ?? 'languageCharacteristics'} ${this.failure}`;
  }
}

@ValidatorConstraint({ name: 'isSamplesByLanguage', async: false })
export class IsSamplesByLanguageConstraint implements ValidatorConstraintInterface {
  private failure = 'must be a map of language id to sample utterances';

  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (!isPlainObject(value)) {
      this.failure = 'must be an object keyed by language id';
      return false;
    }

    for (const [languageId, samples] of Object.entries(value)) {
      if (!/^\d+$/.test(languageId)) {
        this.failure = `"${languageId}" is not a valid language id`;
        return false;
      }
      if (!Array.isArray(samples)) {
        this.failure = `language ${languageId} must map to an array of samples`;
        return false;
      }
      if (samples.length > MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT) {
        this.failure =
          `language ${languageId} has more than ` +
          `${MAX_CHARACTER_LINGUISTIC_STYLE_SAMPLES_COUNT} samples`;
        return false;
      }
      if (
        samples.some(
          (sample) =>
            typeof sample !== 'string' || sample.length > MAX_SAMPLE_LENGTH,
        )
      ) {
        this.failure =
          `each sample for language ${languageId} must be text of ` +
          `≤${MAX_SAMPLE_LENGTH} chars`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `${args?.property ?? 'linguisticStyleSamples'} ${this.failure}`;
  }
}
