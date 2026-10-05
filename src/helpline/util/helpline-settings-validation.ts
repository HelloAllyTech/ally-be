import { HELPLINE_LANGUAGES } from '../constants/helpline.constants';
import {
  HelplineHours,
  HelplineSettings,
  HelplineSummaryField,
} from '../type/helpline.types';
import { HH_MM, assertTimeZone } from './helpline-hours';

/**
 * Validation and merging for `TEXT_HELPLINE_SETTINGS` (contract §8).
 *
 * Stored settings are a PARTIAL; `mergeHelplineSettings` lays them over the
 * defaults on every read. Two merge shapes, deliberately:
 *  - small objects (`copilot`, `supervisorAlertChannels`) merge key by key, so
 *    a new sub-setting gets its default;
 *  - per-language records (`emergencyResources`, `closingMessage`) REPLACE
 *    whole. An org that edits its emergency numbers owns every language of
 *    them — merging would leave the default Hindi text naming numbers the org
 *    just changed in English.
 *
 * Unknown keys in a patch are dropped, not rejected: they cannot widen access,
 * and the admin form is built in parallel against the contract.
 */

const LIMITS = {
  retentionDays: [0, 3650],
  maxWaitMinutes: [1, 240],
  idleEndMinutes: [1, 240],
  maxWaitingTalkers: [1, 1000],
  orgMaxConcurrentPerListener: [1, 10],
  rollingSummaryEveryTurns: [1, 50],
} as const;

const TEXT_MAX = 1000;
const SHORT_TEXT_MAX = 500;
const CHECKLIST_MAX_ITEMS = 20;
const CHECKLIST_ITEM_MAX = 300;
const SUMMARY_FIELDS_MAX = 12;
const SUMMARY_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const SLACK_PREFIX = 'https://hooks.slack.com/';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isLanguage = (v: unknown): v is string =>
  typeof v === 'string' &&
  (HELPLINE_LANGUAGES as readonly string[]).includes(v);

export interface SettingsValidationResult {
  value: Partial<HelplineSettings>;
  errors: string[];
}

export function validateHelplineSettingsPatch(
  patch: unknown,
): SettingsValidationResult {
  const errors: string[] = [];
  const value: Partial<HelplineSettings> = {};
  if (patch == null) return { value, errors };
  if (!isObject(patch)) {
    return { value, errors: ['settings must be an object'] };
  }

  const int = (key: keyof typeof LIMITS, raw: unknown, path: string = key) => {
    const [min, max] = LIMITS[key];
    if (
      !Number.isInteger(raw) ||
      (raw as number) < min ||
      (raw as number) > max
    ) {
      errors.push(`${path} must be a whole number from ${min} to ${max}`);
      return undefined;
    }
    return raw as number;
  };
  const bool = (path: string, raw: unknown) => {
    if (typeof raw !== 'boolean') {
      errors.push(`${path} must be true or false`);
      return undefined;
    }
    return raw;
  };
  const nullableText = (path: string, raw: unknown, max: number) => {
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.length > max) {
      errors.push(`${path} must be text of at most ${max} characters, or null`);
      return undefined;
    }
    return raw.trim() === '' ? null : raw.trim();
  };
  const languageRecord = (path: string, raw: unknown) => {
    if (!isObject(raw)) {
      errors.push(`${path} must map language codes to text`);
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [lang, text] of Object.entries(raw)) {
      if (!isLanguage(lang)) {
        errors.push(`${path}.${lang}: unsupported language`);
        continue;
      }
      if (typeof text !== 'string' || text.length > TEXT_MAX) {
        errors.push(
          `${path}.${lang} must be text of at most ${TEXT_MAX} characters`,
        );
        continue;
      }
      if (text.trim()) out[lang] = text.trim();
    }
    // English is the fallback for every other language, so it must exist.
    if (!out.en) errors.push(`${path}.en is required (it is the fallback)`);
    return out;
  };

  for (const [key, raw] of Object.entries(patch)) {
    switch (key) {
      case 'retentionDays':
      case 'maxWaitMinutes':
      case 'idleEndMinutes':
      case 'maxWaitingTalkers':
      case 'orgMaxConcurrentPerListener': {
        const v = int(key, raw);
        if (v !== undefined) value[key] = v;
        break;
      }
      case 'allowQueueWhenNoListeners': {
        const v = bool(key, raw);
        if (v !== undefined) value.allowQueueWhenNoListeners = v;
        break;
      }
      case 'hours': {
        const v = validateHours(raw, errors);
        if (v !== undefined) value.hours = v;
        break;
      }
      case 'languages': {
        if (
          !Array.isArray(raw) ||
          raw.length === 0 ||
          !raw.every(isLanguage) ||
          new Set(raw).size !== raw.length
        ) {
          errors.push(
            `languages must be a non-empty list of distinct codes from ${HELPLINE_LANGUAGES.join(', ')}`,
          );
        } else {
          value.languages = [...raw];
        }
        break;
      }
      case 'emergencyResources':
      case 'closingMessage': {
        const v = languageRecord(key, raw);
        if (v !== undefined) value[key] = v;
        break;
      }
      case 'escalationChecklist': {
        if (
          !Array.isArray(raw) ||
          raw.length > CHECKLIST_MAX_ITEMS ||
          !raw.every(
            (item) =>
              typeof item === 'string' &&
              item.trim() !== '' &&
              item.length <= CHECKLIST_ITEM_MAX,
          )
        ) {
          errors.push(
            `escalationChecklist must be at most ${CHECKLIST_MAX_ITEMS} non-empty items of at most ${CHECKLIST_ITEM_MAX} characters`,
          );
        } else {
          value.escalationChecklist = raw.map((item: string) => item.trim());
        }
        break;
      }
      case 'supervisorAlertChannels': {
        if (!isObject(raw)) {
          errors.push('supervisorAlertChannels must be an object');
          break;
        }
        const out: Partial<HelplineSettings['supervisorAlertChannels']> = {};
        if ('inApp' in raw) {
          const v = bool('supervisorAlertChannels.inApp', raw.inApp);
          if (v !== undefined) out.inApp = v;
        }
        if ('push' in raw) {
          const v = bool('supervisorAlertChannels.push', raw.push);
          if (v !== undefined) out.push = v;
        }
        if ('slackWebhookUrl' in raw) {
          const url = raw.slackWebhookUrl;
          if (url === null || url === '') {
            out.slackWebhookUrl = null;
          } else if (
            typeof url !== 'string' ||
            !url.startsWith(SLACK_PREFIX) ||
            url.length > SHORT_TEXT_MAX ||
            /\s/.test(url)
          ) {
            errors.push(
              `supervisorAlertChannels.slackWebhookUrl must start with ${SLACK_PREFIX}`,
            );
          } else {
            out.slackWebhookUrl = url;
          }
        }
        value.supervisorAlertChannels =
          out as HelplineSettings['supervisorAlertChannels'];
        break;
      }
      case 'listenerSupportContact':
      case 'ageNotice': {
        const v = nullableText(key, raw, SHORT_TEXT_MAX);
        if (v !== undefined) value[key] = v;
        break;
      }
      case 'copilot': {
        if (!isObject(raw)) {
          errors.push('copilot must be an object');
          break;
        }
        const out: Partial<HelplineSettings['copilot']> = {};
        for (const flag of [
          'suggestions',
          'nudges',
          'riskClassifier',
        ] as const) {
          if (flag in raw) {
            const v = bool(`copilot.${flag}`, raw[flag]);
            if (v !== undefined) out[flag] = v;
          }
        }
        if ('rollingSummaryEveryTurns' in raw) {
          const v = int(
            'rollingSummaryEveryTurns',
            raw.rollingSummaryEveryTurns,
            'copilot.rollingSummaryEveryTurns',
          );
          if (v !== undefined) out.rollingSummaryEveryTurns = v;
        }
        value.copilot = out as HelplineSettings['copilot'];
        break;
      }
      case 'riskHighConfidence': {
        if (typeof raw !== 'number' || !(raw >= 0 && raw <= 1)) {
          errors.push('riskHighConfidence must be a number from 0 to 1');
        } else {
          value.riskHighConfidence = raw;
        }
        break;
      }
      case 'summaryFields': {
        const v = validateSummaryFields(raw, errors);
        if (v) value.summaryFields = v;
        break;
      }
      default:
        // Unknown key: dropped (see the file comment).
        break;
    }
  }

  return { value, errors };
}

function validateHours(
  raw: unknown,
  errors: string[],
): HelplineHours | null | undefined {
  if (raw === null) return null;
  if (
    !isObject(raw) ||
    typeof raw.tz !== 'string' ||
    !Array.isArray(raw.weekly)
  ) {
    errors.push('hours must be null or { tz, weekly: [...] }');
    return undefined;
  }
  try {
    assertTimeZone(raw.tz);
  } catch {
    errors.push(`hours.tz "${raw.tz}" is not a known time zone`);
    return undefined;
  }
  if (raw.weekly.length > 21) {
    errors.push('hours.weekly has at most 21 entries');
    return undefined;
  }
  const weekly: HelplineHours['weekly'] = [];
  for (const [i, entry] of raw.weekly.entries()) {
    if (
      !isObject(entry) ||
      !Number.isInteger(entry.day) ||
      (entry.day as number) < 0 ||
      (entry.day as number) > 6 ||
      typeof entry.open !== 'string' ||
      typeof entry.close !== 'string' ||
      !HH_MM.test(entry.open) ||
      !HH_MM.test(entry.close)
    ) {
      errors.push(
        `hours.weekly[${i}] must be { day: 0-6, open: "HH:MM", close: "HH:MM" }`,
      );
      continue;
    }
    if (entry.open >= entry.close) {
      errors.push(
        `hours.weekly[${i}]: close must be after open (split overnight hours across two days)`,
      );
      continue;
    }
    weekly.push({
      day: entry.day as HelplineHours['weekly'][number]['day'],
      open: entry.open,
      close: entry.close,
    });
  }
  return { tz: raw.tz, weekly };
}

function validateSummaryFields(
  raw: unknown,
  errors: string[],
): HelplineSummaryField[] | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > SUMMARY_FIELDS_MAX
  ) {
    errors.push(`summaryFields must have 1 to ${SUMMARY_FIELDS_MAX} fields`);
    return undefined;
  }
  const keys = new Set<string>();
  const out: HelplineSummaryField[] = [];
  for (const [i, field] of raw.entries()) {
    if (
      !isObject(field) ||
      typeof field.key !== 'string' ||
      !SUMMARY_KEY.test(field.key) ||
      typeof field.label !== 'string' ||
      !field.label.trim() ||
      field.label.length > 80 ||
      (field.description != null &&
        (typeof field.description !== 'string' ||
          field.description.length > 300))
    ) {
      errors.push(
        `summaryFields[${i}] needs a snake_case key, a label (≤ 80) and a description (≤ 300)`,
      );
      return undefined;
    }
    if (keys.has(field.key)) {
      errors.push(`summaryFields: duplicate key "${field.key}"`);
      return undefined;
    }
    keys.add(field.key);
    out.push({
      key: field.key,
      label: field.label.trim(),
      description:
        typeof field.description === 'string' ? field.description.trim() : '',
    });
  }
  return out;
}

/** Stored partial over defaults. Never mutates either argument. */
export function mergeHelplineSettings(
  defaults: HelplineSettings,
  stored: Partial<HelplineSettings> | null | undefined,
): HelplineSettings {
  const s = stored ?? {};
  const merged: HelplineSettings = {
    ...structuredClone(defaults),
    ...structuredClone(
      Object.fromEntries(
        Object.entries(s).filter(([key]) => key in defaults),
      ) as Partial<HelplineSettings>,
    ),
  };
  merged.copilot = { ...defaults.copilot, ...(s.copilot ?? {}) };
  merged.supervisorAlertChannels = {
    ...defaults.supervisorAlertChannels,
    ...(s.supervisorAlertChannels ?? {}),
  };
  return merged;
}

/** A patch over the currently stored partial, the shape that gets persisted. */
export function applyHelplineSettingsPatch(
  stored: Partial<HelplineSettings> | null | undefined,
  patch: Partial<HelplineSettings>,
): Partial<HelplineSettings> {
  const next: Partial<HelplineSettings> = { ...(stored ?? {}), ...patch };
  if (patch.copilot) {
    next.copilot = {
      ...(stored?.copilot ?? {}),
      ...patch.copilot,
    } as HelplineSettings['copilot'];
  }
  if (patch.supervisorAlertChannels) {
    next.supervisorAlertChannels = {
      ...(stored?.supervisorAlertChannels ?? {}),
      ...patch.supervisorAlertChannels,
    } as HelplineSettings['supervisorAlertChannels'];
  }
  return next;
}

/** The org text for `language`, falling back to English. */
export function pickLanguageText(
  record: Record<string, string>,
  language: string,
): string | null {
  return record[language] ?? record.en ?? null;
}
