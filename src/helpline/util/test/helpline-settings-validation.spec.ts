import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  applyHelplineSettingsPatch,
  mergeHelplineSettings,
  pickLanguageText,
  validateHelplineSettingsPatch,
} from '../helpline-settings-validation';

const errorsOf = (patch: unknown) =>
  validateHelplineSettingsPatch(patch).errors;

describe('helpline settings', () => {
  describe('defaults', () => {
    it('match contract §8', () => {
      expect(HELPLINE_DEFAULT_SETTINGS).toMatchObject({
        retentionDays: 90,
        hours: null,
        languages: ['en', 'hi'],
        allowQueueWhenNoListeners: false,
        maxWaitMinutes: 30,
        idleEndMinutes: 15,
        maxWaitingTalkers: 50,
        orgMaxConcurrentPerListener: 3,
        riskHighConfidence: 0.7,
        copilot: {
          suggestions: true,
          nudges: true,
          riskClassifier: true,
          rollingSummaryEveryTurns: 4,
        },
      });
      expect(HELPLINE_DEFAULT_SETTINGS.summaryFields.map((f) => f.key)).toEqual(
        ['presenting_concern', 'feelings', 'risk', 'supports', 'next_step'],
      );
      expect(HELPLINE_DEFAULT_SETTINGS.escalationChecklist).toHaveLength(6);
    });

    it('name Tele-MANAS and 112, and not the discontinued KIRAN line', () => {
      const all = Object.values(
        HELPLINE_DEFAULT_SETTINGS.emergencyResources,
      ).join(' ');
      expect(all).toContain('14416');
      expect(all).toContain('1-800-891-4416');
      expect(all).toContain('112');
      expect(all).not.toMatch(/KIRAN|1800-599-0019/i);
      expect(Object.keys(HELPLINE_DEFAULT_SETTINGS.emergencyResources)).toEqual(
        ['en', 'hi'],
      );
    });
  });

  describe('merge', () => {
    it('returns the defaults when nothing is stored', () => {
      expect(mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, null)).toEqual(
        HELPLINE_DEFAULT_SETTINGS,
      );
    });

    it('lays a stored partial over the defaults', () => {
      const merged = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, {
        maxWaitMinutes: 45,
        hours: {
          tz: 'Asia/Kolkata',
          weekly: [{ day: 1, open: '09:00', close: '17:00' }],
        },
      });
      expect(merged.maxWaitMinutes).toBe(45);
      expect(merged.hours?.tz).toBe('Asia/Kolkata');
      expect(merged.idleEndMinutes).toBe(15);
    });

    it('merges copilot and alert channels key by key, so a new sub-setting gets its default', () => {
      const merged = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, {
        copilot: { nudges: false } as never,
      });
      expect(merged.copilot).toEqual({
        suggestions: true,
        nudges: false,
        riskClassifier: true,
        rollingSummaryEveryTurns: 4,
      });
    });

    it('replaces per-language records whole (an org owns all its emergency numbers)', () => {
      const merged = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, {
        emergencyResources: { en: 'Call our crisis line: 1800-000-0000' },
      });
      expect(merged.emergencyResources).toEqual({
        en: 'Call our crisis line: 1800-000-0000',
      });
      expect(pickLanguageText(merged.emergencyResources, 'hi')).toBe(
        'Call our crisis line: 1800-000-0000',
      );
    });

    it('ignores stored keys the defaults do not know', () => {
      const merged = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, {
        bogus: 1,
      } as never);
      expect(merged).not.toHaveProperty('bogus');
    });

    it('does not mutate the defaults', () => {
      const before = JSON.stringify(HELPLINE_DEFAULT_SETTINGS);
      const merged = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, null);
      merged.languages.push('ta');
      expect(JSON.stringify(HELPLINE_DEFAULT_SETTINGS)).toBe(before);
    });

    it('a patch over stored settings keeps unrelated stored keys and merges copilot', () => {
      const next = applyHelplineSettingsPatch(
        { maxWaitMinutes: 45, copilot: { nudges: false } as never },
        { copilot: { suggestions: false } as never },
      );
      expect(next).toEqual({
        maxWaitMinutes: 45,
        copilot: { nudges: false, suggestions: false },
      });
    });
  });

  describe('validation', () => {
    it('accepts a full valid patch', () => {
      const { value, errors } = validateHelplineSettingsPatch({
        retentionDays: 0,
        languages: ['en', 'ta'],
        maxWaitingTalkers: 10,
        supervisorAlertChannels: {
          slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
        },
        summaryFields: [
          { key: 'concern', label: 'Concern', description: 'What it is about' },
        ],
        hours: {
          tz: 'Asia/Kolkata',
          weekly: [{ day: 0, open: '08:00', close: '20:00' }],
        },
      });
      expect(errors).toEqual([]);
      expect(value.retentionDays).toBe(0);
    });

    it('only accepts Slack incoming-webhook URLs', () => {
      expect(
        errorsOf({
          supervisorAlertChannels: {
            slackWebhookUrl: 'https://evil.example.com/x',
          },
        }),
      ).toHaveLength(1);
      expect(
        errorsOf({
          supervisorAlertChannels: {
            slackWebhookUrl: 'http://hooks.slack.com/x',
          },
        }),
      ).toHaveLength(1);
      expect(
        errorsOf({ supervisorAlertChannels: { slackWebhookUrl: null } }),
      ).toEqual([]);
    });

    it('bounds the numbers', () => {
      expect(errorsOf({ maxWaitMinutes: 0 })).toHaveLength(1);
      expect(errorsOf({ orgMaxConcurrentPerListener: 11 })).toHaveLength(1);
      expect(errorsOf({ retentionDays: 1.5 })).toHaveLength(1);
      expect(errorsOf({ riskHighConfidence: 1.2 })).toHaveLength(1);
      expect(
        errorsOf({ copilot: { rollingSummaryEveryTurns: 0 } }),
      ).toHaveLength(1);
    });

    it('limits languages to en/hi/mr/ta/kn, non-empty and distinct', () => {
      expect(errorsOf({ languages: ['en', 'fr'] })).toHaveLength(1);
      expect(errorsOf({ languages: [] })).toHaveLength(1);
      expect(errorsOf({ languages: ['en', 'en'] })).toHaveLength(1);
    });

    it('requires English in per-language text and caps its length', () => {
      expect(errorsOf({ closingMessage: { hi: 'धन्यवाद' } })).toHaveLength(1);
      expect(
        errorsOf({ closingMessage: { en: 'x'.repeat(1001) } }).length,
      ).toBeGreaterThan(0);
      expect(
        errorsOf({ closingMessage: { en: 'Thanks', fr: 'Merci' } }),
      ).toHaveLength(1);
    });

    it('validates hours: zone, HH:MM, close after open', () => {
      expect(
        errorsOf({ hours: { tz: 'Mars/Olympus', weekly: [] } }),
      ).toHaveLength(1);
      expect(
        errorsOf({
          hours: {
            tz: 'Asia/Kolkata',
            weekly: [{ day: 1, open: '9:00', close: '17:00' }],
          },
        }),
      ).toHaveLength(1);
      expect(
        errorsOf({
          hours: {
            tz: 'Asia/Kolkata',
            weekly: [{ day: 1, open: '22:00', close: '06:00' }],
          },
        }),
      ).toHaveLength(1);
      expect(errorsOf({ hours: null })).toEqual([]);
    });

    it('validates summary fields', () => {
      expect(errorsOf({ summaryFields: [] })).toHaveLength(1);
      expect(
        errorsOf({
          summaryFields: [{ key: 'Bad Key', label: 'x', description: '' }],
        }),
      ).toHaveLength(1);
      expect(
        errorsOf({
          summaryFields: [
            { key: 'a', label: 'A', description: '' },
            { key: 'a', label: 'A again', description: '' },
          ],
        }),
      ).toHaveLength(1);
    });

    it('caps free text', () => {
      expect(errorsOf({ ageNotice: 'x'.repeat(501) })).toHaveLength(1);
      expect(errorsOf({ escalationChecklist: ['ok', ''] })).toHaveLength(1);
    });

    it('drops unknown keys rather than rejecting them', () => {
      const { value, errors } = validateHelplineSettingsPatch({
        notASetting: true,
        maxWaitMinutes: 20,
      });
      expect(errors).toEqual([]);
      expect(value).toEqual({ maxWaitMinutes: 20 });
    });

    it('rejects a non-object', () => {
      expect(errorsOf('nope')).toHaveLength(1);
      expect(errorsOf(null)).toEqual([]);
    });
  });
});
